// Belgiumdia Watches → Shopify Product Sync
// Syncs only watch products from belgiumdia to Shopify

const https = require('https');
const querystring = require('querystring');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';
const API_VERSION = '2024-01';

// Helper: Make HTTPS requests
function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

// Get Admin API access token using Client Credentials grant
async function getAccessToken() {
  const configuredToken = (process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
  if (configuredToken) {
    console.log('[WATCH SYNC] Using Admin API token from environment');
    return configuredToken;
  }

  console.log('[WATCH SYNC] Requesting fresh Admin API access token via OAuth...');
  
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('Missing SHOPIFY_ACCESS_TOKEN/SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET');
  }

  const tokenBody = querystring.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'write_products,read_products'
  });

  const options = {
    hostname: STORE_DOMAIN,
    path: '/admin/oauth/access_token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(tokenBody)
    }
  };

  try {
    const response = await makeRequest(options, tokenBody);
    
    if (response.status === 200 && response.body?.access_token) {
      const token = response.body.access_token;
      console.log(`[WATCH SYNC] ✅ Got access token (expires in ${response.body.expires_in || 86400}s)`);
      return token;
    } else {
      const errorDetail = response.body?.error || response.body?.errors || 'Unknown error';
      throw new Error(`Token request failed (${response.status}): ${JSON.stringify(errorDetail)}`);
    }
  } catch (e) {
    console.error('[WATCH SYNC] ❌ Token request failed:', e.message);
    throw e;
  }
}

// Fetch watch data from belgiumdia proxy
async function fetchWatchData(page = 1, limit = 50) {
  console.log(`[WATCH SYNC] Fetching belgiumdia watch data (page ${page})`);
  
  try {
    const url = new URL(PROXY_URL);
    url.searchParams.append('type', 'watch');
    url.searchParams.append('page', page);
    url.searchParams.append('limit', limit);

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Proxy returned ${response.status}`);
    
    const data = await response.json();
    console.log(`[WATCH SYNC] Got ${(data.items || []).length} watch items from belgiumdia`);
    return data;
  } catch (e) {
    console.error(`[WATCH SYNC] Failed to fetch watch data:`, e.message);
    throw e;
  }
}

// Check if product exists in Shopify by SKU
async function findProductBySku(sku, accessToken) {
  const options = {
    hostname: STORE_DOMAIN,
    path: `/admin/api/${API_VERSION}/graphql.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    }
  };

  const query = {
    query: `{
      products(first: 1, query: "sku:${sku}") {
        edges {
          node {
            id
            handle
            variants(first: 1) {
              edges {
                node {
                  id
                  sku
                }
              }
            }
          }
        }
      }
    }`
  };

  try {
    const response = await makeRequest(options, query);
    const edges = response.body?.data?.products?.edges || [];
    return edges.length > 0 ? edges[0].node : null;
  } catch (e) {
    console.error(`[WATCH SYNC] Error finding product by SKU ${sku}:`, e.message);
    return null;
  }
}

// Create Shopify product
async function createProduct(item, accessToken) {
  const title = item.Name || 
    `${item.Brand || 'Watch'} ${item.Model || 'Unknown'}`.trim();

  const description = [
    item.Brand ? `Brand: ${item.Brand}` : null,
    item.Model ? `Model: ${item.Model}` : null,
    item.Movement ? `Movement: ${item.Movement}` : null,
    item.Case_Material ? `Case Material: ${item.Case_Material}` : null,
    item.Water_Resistance ? `Water Resistance: ${item.Water_Resistance}` : null,
    item.Condition ? `Condition: ${item.Condition}` : null
  ].filter(Boolean).join(' | ');

  const options = {
    hostname: STORE_DOMAIN,
    path: `/admin/api/${API_VERSION}/products.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    }
  };

  const body = {
    product: {
      title,
      body_html: description,
      vendor: 'Belgiumdia',
      product_type: 'watch',
      tags: ['belgiumdia', 'watch'],
      status: 'active',
      variants: [
        {
          sku: item.Stock_No,
          price: parseFloat(item.Buy_Price) || 0,
          barcode: item.Stock_No,
          inventory_quantity: 1,
          requires_shipping: true
        }
      ],
      images: item.ImageLink ? [{ src: item.ImageLink }] : []
    }
  };

  try {
    const response = await makeRequest(options, body);
    
    if (response.status !== 201) {
      console.error(`[WATCH SYNC] Failed to create product: ${response.status}`, response.body);
      return null;
    }

    const productId = response.body.product.id;
    console.log(`[WATCH SYNC] ✅ Created watch: ${title} (ID: ${productId})`);
    
    // Add to Watches collection
    await addProductToCollection(productId, 'watches', accessToken);
    
    return response.body.product;
  } catch (e) {
    console.error(`[WATCH SYNC] Error creating product:`, e.message);
    return null;
  }
}

// Add product to collection
async function addProductToCollection(productId, collectionHandle, accessToken) {
  const options = {
    hostname: STORE_DOMAIN,
    path: `/admin/api/${API_VERSION}/graphql.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    }
  };

  // First, find collection by handle
  const findQuery = {
    query: `{
      collections(first: 1, query: "handle:${collectionHandle.toLowerCase()}") {
        edges {
          node {
            id
          }
        }
      }
    }`
  };

  try {
    const findResponse = await makeRequest(options, findQuery);
    const collections = findResponse.body?.data?.collections?.edges || [];
    
    if (collections.length === 0) {
      console.log(`[WATCH SYNC] ⚠️  Collection not found: ${collectionHandle}`);
      return;
    }

    const collectionId = collections[0].node.id;
    
    // Add product to collection
    const addQuery = {
      query: `mutation {
        collectionProductsAdd(id: "${collectionId}", productIds: ["${productId}"]) {
          userErrors { field message }
        }
      }`
    };

    await makeRequest(options, addQuery);
    console.log(`[WATCH SYNC] ✅ Added watch to collection: ${collectionHandle}`);
  } catch (e) {
    console.log(`[WATCH SYNC] Could not add to collection ${collectionHandle}: ${e.message}`);
  }
}

// Main sync function for watches
async function syncWatches() {
  console.log('\n========== BELGIUMDIA WATCH SYNC START ==========');
  const startTime = Date.now();
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  try {
    // Get access token
    const accessToken = await getAccessToken();

    console.log(`\n[WATCH SYNC] Processing watches...`);
    
    try {
      const data = await fetchWatchData(1, 50);
      const items = (data.items || []).slice(0, 50); // Process all watches (no limit)

      for (const item of items) {
        if (!item.Stock_No) {
          console.log(`[WATCH SYNC] Skipping item without SKU`);
          totalSkipped++;
          continue;
        }

        // Check if product already exists
        const existing = await findProductBySku(item.Stock_No, accessToken);
        
        if (existing) {
          console.log(`[WATCH SYNC] ⏭️  Watch already exists: ${item.Stock_No}`);
          totalSkipped++;
          continue;
        }

        // Create new product
        const created = await createProduct(item, accessToken);
        if (created) {
          totalCreated++;
        } else {
          totalFailed++;
          console.log(`[WATCH SYNC] ❌ Failed to create watch: ${item.Stock_No}`);
        }

        // Rate limiting: Shopify API allows 2 requests/sec
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (e) {
      console.error(`[WATCH SYNC] Error processing watches:`, e.message);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n========== WATCH SYNC COMPLETE ==========`);
    console.log(`Created: ${totalCreated} | Skipped: ${totalSkipped} | Failed: ${totalFailed} | Duration: ${duration}s\n`);

    return {
      success: true,
      type: 'watch',
      created: totalCreated,
      skipped: totalSkipped,
      failed: totalFailed,
      duration: duration
    };
  } catch (e) {
    console.error('[WATCH SYNC] FATAL ERROR:', e.message);
    return {
      success: false,
      error: e.message
    };
  }
}

// Vercel handler
module.exports = async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version,X-Response-Time,X-Request-Id');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const result = await syncWatches();
    res.status(200).json(result);
  } catch (e) {
    console.error('[WATCH SYNC] Handler error:', e);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
};