// Natural Diamond Sync - Type-Specific Endpoint
// Syncs natural diamonds incrementally, respecting rate-limits and request timeouts
// Progress persisted so sync can resume across invocations

const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';
const API_VERSION = '2024-01';
const TYPE = 'natural';
const PROGRESS_FILE = '/tmp/sync_progress_natural.json';
const BATCH_SIZE = 50; // items per batch
const PAGES_PER_RUN = 1; // pages to fetch per invocation (to stay within 300s limit)

function logInfo(runId, message, extra = null) {
  if (extra !== null) {
    console.log(`[SYNC-NATURAL][${runId}] ${message}`, extra);
    return;
  }
  console.log(`[SYNC-NATURAL][${runId}] ${message}`);
}

function logError(runId, message, extra = null) {
  if (extra !== null) {
    console.error(`[SYNC-NATURAL][${runId}] ${message}`, extra);
    return;
  }
  console.error(`[SYNC-NATURAL][${runId}] ${message}`);
}

function safeSnippet(value, maxLen = 250) {
  if (!value) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

// Load progress from file
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error(`Failed to load progress: ${e.message}`);
  }
  return {
    current_page: 1,
    current_item_index: 0,
    total_items_created: 0,
    total_items_skipped: 0,
    total_items_failed: 0,
    pages_processed: 0,
    cooldown_until: null,
    last_updated: null
  };
}

// Save progress to file
function saveProgress(progress) {
  try {
    progress.last_updated = new Date().toISOString();
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`Failed to save progress: ${e.message}`);
    return false;
  }
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

// Get Admin API access token
async function getAccessToken(runId) {
  const configuredToken = (process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
  if (configuredToken) {
    logInfo(runId, 'Using Admin API token from environment');
    return configuredToken;
  }

  logInfo(runId, 'Requesting fresh Admin API access token via OAuth');
  
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
async function fetchBelgiumdiaData(page = 1, limit = 50, runId) {
  logInfo(runId, `Fetching Belgiumdia ${TYPE} data`, { page, limit });
  
  try {
    const url = new URL(PROXY_URL);
    url.searchParams.append('type', TYPE);
    url.searchParams.append('page', page);
    url.searchParams.append('limit', limit);

    const response = await fetch(url.toString());
    const rawText = await response.text();
    
    if (!response.ok) {
      logError(runId, `Proxy returned ${response.status} for ${TYPE} page ${page}`, safeSnippet(rawText));
      
      // Check for rate-limit response
      try {
        const body = JSON.parse(rawText);
        if (body.error && body.error.includes('Rate limit exceeded')) {
          const match = body.error.match(/Try again in (\d+) second/);
          if (match) {
            const cooldownSeconds = parseInt(match[1], 10);
            logInfo(runId, `Rate-limit detected: cooldown ${cooldownSeconds}s`);
            return { 
              error: 'RATE_LIMITED',
              cooldown_seconds: cooldownSeconds,
              retry_after: Date.now() + (cooldownSeconds * 1000)
            };
          }
        }
      } catch (e) {
        // JSON parse failed, continue with generic error
      }
      
      throw new Error(`Proxy returned ${response.status}: ${safeSnippet(rawText, 120)}`);
    }

    const data = JSON.parse(rawText);
    logInfo(runId, `Fetched page from proxy`, {
      type: TYPE,
      page,
      received_items: (data.items || []).length,
      total_pages: data.total_pages || null,
      cache_hit: Boolean(data.cache_hit),
      stale: Boolean(data.stale),
    });
    return data;
  } catch (e) {
    logError(runId, `Failed to fetch Belgiumdia data for ${TYPE} page ${page}: ${e.message}`);
    throw e;
  }
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
async function createProduct(item, accessToken, runId) {
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
      product_type: TYPE,
      tags: ['belgiumdia', TYPE],
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
    logInfo(runId, `Created product SKU=${item.Stock_No} ID=${productId}`);
    
    // Add to Natural Diamonds collection
    await addProductToCollection(productId, 'Natural Diamonds', accessToken, runId);
    
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

  const findQuery = {
    query: `{
      collections(first: 1, query: "handle:${collectionHandle.toLowerCase().replace(/\s+/g, '-')}") {
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
      logError(runId, `Collection add returned userErrors`, addErrors);
      return;
    }

    logInfo(runId, `Added product ${productId} to collection: ${collectionHandle}`);
  } catch (e) {
    logError(runId, `Could not add to collection ${collectionHandle}: ${e.message}`);
  }
}

// Main sync function
async function syncNatural(runId) {
  logInfo(runId, '========== NATURAL DIAMOND SYNC START ==========');
  const startTime = Date.now();
  
  // Load progress
  let progress = loadProgress();
  logInfo(runId, 'Loaded progress', {
    current_page: progress.current_page,
    current_item_index: progress.current_item_index,
    total_created: progress.total_items_created,
    total_skipped: progress.total_items_skipped,
  });

  // Check if on cooldown
  if (progress.cooldown_until && Date.now() < progress.cooldown_until) {
    const remainingSeconds = Math.ceil((progress.cooldown_until - Date.now()) / 1000);
    logInfo(runId, `On rate-limit cooldown, ${remainingSeconds}s remaining`);
    return {
      success: true,
      status: 'COOLDOWN',
      run_id: runId,
      cooldown_seconds: remainingSeconds,
      progress: {
        current_page: progress.current_page,
        total_created: progress.total_items_created,
        total_skipped: progress.total_items_skipped
      }
    };
  }

  try {
    const accessToken = await getAccessToken(runId);
    
    let pagesProcessedThisRun = 0;
    let createdThisRun = 0;
    let skippedThisRun = 0;
    let failedThisRun = 0;

    // Process up to PAGES_PER_RUN pages in this invocation
    while (pagesProcessedThisRun < PAGES_PER_RUN) {
      logInfo(runId, `Fetching page ${progress.current_page}`);
      const data = await fetchBelgiumdiaData(progress.current_page, BATCH_SIZE, runId);

      // Check for rate-limit error
      if (data.error === 'RATE_LIMITED') {
        progress.cooldown_until = data.retry_after;
        saveProgress(progress);
        logInfo(runId, `Rate-limited, scheduling retry in ${data.cooldown_seconds}s`);
        return {
          success: true,
          status: 'RATE_LIMITED',
          run_id: runId,
          cooldown_seconds: data.cooldown_seconds,
          progress: {
            current_page: progress.current_page,
            total_created: progress.total_items_created + createdThisRun,
            total_skipped: progress.total_items_skipped + skippedThisRun
          }
        };
      }

      const items = data.items || [];
      const totalPages = data.total_pages || 1;
      
      if (items.length === 0) {
        logInfo(runId, `No more items (reached end at page ${progress.current_page})`);
        break;
      }

      logInfo(runId, `Processing ${items.length} items from page ${progress.current_page}`);

      // Process items starting from current_item_index (for resume capability)
      for (let i = progress.current_item_index; i < items.length; i++) {
        const item = items[i];

        if (!item.Stock_No) {
          logInfo(runId, `Skipping item without SKU at index ${i}`);
          skippedThisRun++;
          progress.total_items_skipped++;
          continue;
        }

        // Check if product already exists
        const existing = await findProductBySku(item.Stock_No, accessToken, runId);
        
        if (existing) {
          logInfo(runId, `Product already exists, skipping SKU=${item.Stock_No}`);
          skippedThisRun++;
          progress.total_items_skipped++;
          progress.current_item_index = i + 1;
          saveProgress(progress);
          continue;
        }

        // Create new product
        const created = await createProduct(item, accessToken, runId);
        if (created) {
          createdThisRun++;
          progress.total_items_created++;
        } else {
          failedThisRun++;
          progress.total_items_failed++;
        }

        progress.current_item_index = i + 1;
        saveProgress(progress);

        // Rate limiting: Shopify API allows 2 requests/sec
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Move to next page
      if (progress.current_page < totalPages) {
        progress.current_page++;
        progress.current_item_index = 0;
        pagesProcessedThisRun++;
        saveProgress(progress);
      } else {
        logInfo(runId, `Completed all pages (reached page ${progress.current_page}/${totalPages})`);
        break;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logInfo(runId, '========== SYNC COMPLETE (SESSION) ==========');
    logInfo(runId, `Session: Created=${createdThisRun} Skipped=${skippedThisRun} Failed=${failedThisRun} Duration=${duration}s`);
    logInfo(runId, `Cumulative: Created=${progress.total_items_created} Skipped=${progress.total_items_skipped} Failed=${progress.total_items_failed}`);

    return {
      success: true,
      status: 'PROGRESS',
      run_id: runId,
      session: {
        created: createdThisRun,
        skipped: skippedThisRun,
        failed: failedThisRun,
        duration: duration
      },
      progress: {
        current_page: progress.current_page,
        current_item_index: progress.current_item_index,
        total_created: progress.total_items_created,
        total_skipped: progress.total_items_skipped,
        total_failed: progress.total_items_failed
      }
    };
  } catch (e) {
    logError(runId, `FATAL ERROR: ${e.message}`);
    return {
      success: false,
      run_id: runId,
      error: e.message,
      progress: {
        current_page: progress.current_page,
        total_created: progress.total_items_created,
        total_skipped: progress.total_items_skipped
      }
    };
  }
}

// Vercel handler
module.exports = async (req, res) => {
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version,X-Response-Time,X-Request-Id');
  res.setHeader('X-Sync-Run-Id', runId);

  logInfo(runId, `Incoming request method=${req.method}`);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const result = await syncNatural(runId);
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
