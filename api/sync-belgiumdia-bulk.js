/**
 * Belgiumdia Bulk Sync
 * One-time bulk import of ALL products (use after testing phase)
 * 
 * Usage: POST https://your-url.vercel.app/api/sync-belgiumdia-bulk.js
 * 
 * This syncs ALL products (not limited to 15 per type)
 * Run once to populate Shopify, then use daily cron for updates
 */

const https = require('https');
const querystring = require('querystring');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';
const API_VERSION = '2024-01';

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

async function getAccessToken() {
  const configuredToken = (process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
  if (configuredToken) {
    console.log('[BULK] Using Admin API token from environment');
    return configuredToken;
  }

  console.log('[BULK] Requesting access token via OAuth...');
  
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
      console.log(`[BULK] ✅ Got access token`);
      return token;
    } else {
      throw new Error(`Token request failed (${response.status})`);
    }
  } catch (e) {
    console.error('[BULK] ❌ Token request failed:', e.message);
    throw e;
  }
}

// Fetch ALL pages from proxy (not limited to 15)
async function fetchAllBelgiumdiaData(type) {
  console.log(`[BULK] Fetching ALL ${type} data...`);
  
  let allItems = [];
  let page = 1;
  let hasMore = true;

  try {
    while (hasMore) {
      const url = new URL(PROXY_URL);
      url.searchParams.append('type', type);
      url.searchParams.append('page', page);
      url.searchParams.append('limit', 100); // Max limit

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Proxy returned ${response.status}`);
      
      const data = await response.json();
      const items = data.items || [];
      
      allItems = allItems.concat(items);
      console.log(`[BULK] Fetched page ${page}: ${items.length} items (total: ${allItems.length})`);

      // Check if there are more pages
      if (page >= (data.total_pages || 1)) {
        hasMore = false;
      } else {
        page++;
      }
    }

    console.log(`[BULK] Total ${type} items: ${allItems.length}`);
    return allItems;
  } catch (e) {
    console.error(`[BULK] Failed to fetch all ${type} data:`, e.message);
    return allItems; // Return what we got so far
  }
}

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
    return null;
  }
}

async function createProduct(item, type, accessToken) {
  const title = item.Shape ? 
    `${item.Shape.charAt(0).toUpperCase() + item.Shape.slice(1).toLowerCase()}${item.Weight ? ' - ' + item.Weight + 'ct' : ''}` : 
    (item.Name || 'Product');

  const description = [
    item.Color ? `Color: ${item.Color}` : null,
    item.Clarity ? `Clarity: ${item.Clarity}` : null,
    item.Cut_Grade ? `Cut: ${item.Cut_Grade}` : null,
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
      body_html: description || type,
      vendor: 'Belgiumdia',
      product_type: type,
      tags: ['belgiumdia', type],
      status: 'active',
      variants: [
        {
          sku: item.Stock_No,
          price: parseFloat(item.Buy_Price) || 0,
          barcode: item.Stock_No,
          inventory_quantity: 1,
          requires_shipping: false
        }
      ]
    }
  };

  try {
    const response = await makeRequest(options, body);
    
    if (response.status === 201) {
      return response.body.product;
    } else {
      return null;
    }
  } catch (e) {
    return null;
  }
}

async function syncAllBelgiumdia() {
  console.log('\n========== BELGIUMDIA BULK SYNC START ==========');
  const startTime = Date.now();
  let totalCreated = 0;
  let totalSkipped = 0;

  try {
    const accessToken = await getAccessToken();
    const types = ['natural', 'lab', 'watch', 'jewelry'];
    
    for (const type of types) {
      console.log(`\n[BULK] Processing ALL ${type} items...`);
      
      try {
        const allItems = await fetchAllBelgiumdiaData(type);

        for (let i = 0; i < allItems.length; i++) {
          const item = allItems[i];
          
          if (!item.Stock_No) {
            totalSkipped++;
            continue;
          }

          const existing = await findProductBySku(item.Stock_No, accessToken);
          
          if (existing) {
            totalSkipped++;
            if (i % 50 === 0) console.log(`[BULK] Progress: ${i}/${allItems.length} (${totalCreated} created, ${totalSkipped} skipped)`);
          } else {
            const created = await createProduct(item, type, accessToken);
            if (created) {
              totalCreated++;
              if (totalCreated % 10 === 0) console.log(`[BULK] Created ${totalCreated} products so far...`);
            }
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (e) {
        console.error(`[BULK] Error processing ${type}:`, e.message);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n========== BULK SYNC COMPLETE ==========`);
    console.log(`Created: ${totalCreated} | Skipped: ${totalSkipped} | Duration: ${duration}s\n`);

    return {
      success: true,
      created: totalCreated,
      skipped: totalSkipped,
      duration: duration
    };
  } catch (e) {
    console.error('[BULK] FATAL ERROR:', e.message);
    return {
      success: false,
      error: e.message
    };
  }
}

module.exports = async (req, res) => {
  // Security: Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Optional: Add a simple auth check
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required. Pass token in Bearer header.' });
  }

  try {
    const result = await syncAllBelgiumdia();
    res.status(200).json(result);
  } catch (e) {
    console.error('Handler error:', e);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
};
