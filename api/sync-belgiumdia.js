// Belgiumdia → Shopify Product Sync Function
// Fetches belgiumdia data and creates/updates Shopify products
// Auto-refreshes access token on each invocation (tokens expire after 24h)

const https = require('https');
const querystring = require('querystring');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';
const API_VERSION = '2024-01';

function logInfo(runId, message, extra = null) {
  if (extra !== null) {
    console.log(`[SYNC][${runId}] ${message}`, extra);
    return;
  }
  console.log(`[SYNC][${runId}] ${message}`);
}

function logError(runId, message, extra = null) {
  if (extra !== null) {
    console.error(`[SYNC][${runId}] ${message}`, extra);
    return;
  }
  console.error(`[SYNC][${runId}] ${message}`);
}

function safeSnippet(value, maxLen = 250) {
  if (!value) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

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
// This is called on every function invocation to ensure token is always fresh
async function getAccessToken(runId) {
  logInfo(runId, 'Requesting fresh Admin API access token');
  
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET');
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
      logInfo(runId, `Got access token (expires in ${response.body.expires_in || 86400}s)`);
      return token;
    } else {
      const errorDetail = response.body?.error || response.body?.errors || 'Unknown error';
      throw new Error(`Token request failed (${response.status}): ${JSON.stringify(errorDetail)}`);
    }
  } catch (e) {
    logError(runId, `Token request failed: ${e.message}`);
    throw e;
  }
}

// Fetch belgiumdia data from proxy
async function fetchBelgiumdiaData(type, page = 1, limit = 50, runId) {
  logInfo(runId, `Fetching Belgiumdia data`, { type, page, limit });
  
  try {
    const url = new URL(PROXY_URL);
    url.searchParams.append('type', type);
    url.searchParams.append('page', page);
    url.searchParams.append('limit', limit);

    const response = await fetch(url.toString());
    if (!response.ok) {
      const rawBody = await response.text();
      logError(runId, `Proxy returned ${response.status} for ${type} page ${page}`, safeSnippet(rawBody));
      throw new Error(`Proxy returned ${response.status}: ${safeSnippet(rawBody, 120)}`);
    }

    const data = await response.json();
    logInfo(runId, `Fetched page from proxy`, {
      type,
      page,
      received_items: (data.items || []).length,
      total_pages: data.total_pages || null,
      cache_hit: Boolean(data.cache_hit),
      stale: Boolean(data.stale),
    });
    return data;
  } catch (e) {
    logError(runId, `Failed to fetch Belgiumdia data for ${type} page ${page}: ${e.message}`);
    throw e;
  }
}

async function fetchAllBelgiumdiaData(type, limit = 50, runId) {
  const allItems = [];
  let page = 1;
  let totalPages = 1;
  let pagesFetched = 0;

  logInfo(runId, `Starting full fetch for ${type}`);

  while (page <= totalPages) {
    const data = await fetchBelgiumdiaData(type, page, limit, runId);
    const items = data.items || [];

    allItems.push(...items);
    totalPages = data.total_pages || totalPages;
    pagesFetched++;

    logInfo(runId, `Page progress for ${type}`, {
      page,
      total_pages: totalPages,
      page_items: items.length,
      cumulative_items: allItems.length,
    });

    if (page >= totalPages || items.length === 0) {
      break;
    }

    page++;
  }

  return { items: allItems, pagesFetched, totalPages };
}

// Check if product exists in Shopify by SKU
async function findProductBySku(sku, accessToken, runId) {
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
    logError(runId, `Error finding product by SKU ${sku}: ${e.message}`);
    return null;
  }
}

// Create Shopify product
async function createProduct(item, type, accessToken, runId) {
  const title = item.Shape ? 
    `${item.Shape.charAt(0).toUpperCase() + item.Shape.slice(1).toLowerCase()}${item.Weight ? ' - ' + item.Weight + 'ct' : ''}` : 
    (item.Name || 'Product');

  const description = [
    item.Color ? `Color: ${item.Color}` : null,
    item.Clarity ? `Clarity: ${item.Clarity}` : null,
    item.Cut_Grade ? `Cut: ${item.Cut_Grade}` : null,
    item.Polish ? `Polish: ${item.Polish}` : null,
    item.Symmetry ? `Symmetry: ${item.Symmetry}` : null,
    item.Lab ? `Lab: ${item.Lab}` : null
  ].filter(Boolean).join(' | ');

  const collection_type = type === 'watch' ? 'Watches' : 
                         type === 'jewelry' ? 'Jewelry' : 
                         type === 'natural' ? 'Natural Diamonds' :
                         type === 'lab' ? 'Lab-Grown Diamonds' : null;

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
      ],
      images: item.ImageLink ? [{ src: item.ImageLink }] : []
    }
  };

  try {
    const response = await makeRequest(options, body);
    
    if (response.status !== 201) {
      logError(runId, `Failed to create product SKU=${item.Stock_No} status=${response.status}`, safeSnippet(response.body));
      return null;
    }

    const productId = response.body.product.id;
    logInfo(runId, `Created product SKU=${item.Stock_No} ID=${productId} type=${type}`);
    
    // Add to collection if specified
    if (collection_type) {
      await addProductToCollection(productId, collection_type, accessToken, runId);
    }
    
    return response.body.product;
  } catch (e) {
    logError(runId, `Error creating product SKU=${item.Stock_No}: ${e.message}`);
    return null;
  }
}

// Add product to collection
async function addProductToCollection(productId, collectionHandle, accessToken, runId) {
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
      logInfo(runId, `Collection not found: ${collectionHandle}`);
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

    const addResponse = await makeRequest(options, addQuery);
    const addErrors = addResponse.body?.data?.collectionProductsAdd?.userErrors || [];
    if (addErrors.length > 0) {
      logError(runId, `Collection add returned userErrors for ${collectionHandle}`, addErrors);
      return;
    }

    logInfo(runId, `Added product ${productId} to collection: ${collectionHandle}`);
  } catch (e) {
    logError(runId, `Could not add to collection ${collectionHandle}: ${e.message}`);
  }
}

// Main sync function
async function syncBelgiumdia(runId) {
  logInfo(runId, '========== BELGIUMDIA SYNC START ==========');
  const startTime = Date.now();
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const typeSummary = {};

  try {
    // Get access token
    const accessToken = await getAccessToken(runId);

    // Sync each product type - only first page (50 items per type = ~200 total)
    const types = ['natural', 'lab', 'watch', 'jewelry'];
    logInfo(runId, 'Sync started for types', types);
    
    for (const type of types) {
      logInfo(runId, `Processing type=${type}`);
      const perType = {
        loaded: 0,
        pages_fetched: 0,
        created: 0,
        skipped: 0,
        failed: 0,
        error: null,
      };
      
      try {
        const { items, pagesFetched, totalPages } = await fetchAllBelgiumdiaData(type, 50, runId);
        perType.loaded = items.length;
        perType.pages_fetched = pagesFetched;
        logInfo(runId, `Loaded ${items.length} ${type} items`, { pages_fetched: pagesFetched, total_pages: totalPages });

        let processedForType = 0;

        for (const item of items) {
          processedForType++;

          if (!item.Stock_No) {
            logInfo(runId, `Skipping ${type} item without SKU`);
            totalSkipped++;
            perType.skipped++;
            continue;
          }

          // Check if product already exists
          const existing = await findProductBySku(item.Stock_No, accessToken, runId);
          
          if (existing) {
            logInfo(runId, `Product already exists, skipping SKU=${item.Stock_No}`);
            totalSkipped++;
            perType.skipped++;
            continue;
          }

          // Create new product
          const created = await createProduct(item, type, accessToken, runId);
          if (created) {
            totalCreated++;
            perType.created++;
          } else {
            totalFailed++;
            perType.failed++;
            logError(runId, `Failed to create product SKU=${item.Stock_No}`);
          }

          if (processedForType % 25 === 0) {
            logInfo(runId, `Progress type=${type}`, {
              processed: processedForType,
              total_items: items.length,
              created: perType.created,
              skipped: perType.skipped,
              failed: perType.failed,
            });
          }

          // Rate limiting: Shopify API allows 2 requests/sec
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        typeSummary[type] = perType;
        logInfo(runId, `Completed type=${type}`, perType);
      } catch (e) {
        perType.error = e.message;
        typeSummary[type] = perType;
        logError(runId, `Error processing ${type}: ${e.message}`);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logInfo(runId, '========== SYNC COMPLETE ==========');
    logInfo(runId, `Summary: Created=${totalCreated} Skipped=${totalSkipped} Failed=${totalFailed} Duration=${duration}s`);
    logInfo(runId, 'Type summary', typeSummary);

    return {
      success: true,
      run_id: runId,
      created: totalCreated,
      skipped: totalSkipped,
      failed: totalFailed,
      duration: duration,
      type_summary: typeSummary,
    };
  } catch (e) {
    logError(runId, `FATAL ERROR: ${e.message}`);
    return {
      success: false,
      run_id: runId,
      error: e.message
    };
  }
}

// Vercel handler
module.exports = async (req, res) => {
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version,X-Response-Time,X-Request-Id');
  res.setHeader('X-Sync-Run-Id', runId);

  logInfo(runId, `Incoming request method=${req.method}`);

  if (req.method === 'OPTIONS') {
    logInfo(runId, 'Handled OPTIONS preflight');
    res.status(200).end();
    return;
  }

  try {
    const result = await syncBelgiumdia(runId);
    res.status(200).json(result);
  } catch (e) {
    logError(runId, `Handler error: ${e.message}`);
    res.status(500).json({
      success: false,
      run_id: runId,
      error: e.message
    });
  }
};