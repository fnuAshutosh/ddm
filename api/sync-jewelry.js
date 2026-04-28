// Jewelry Sync - Type-Specific Endpoint
// Syncs jewelry incrementally, respecting rate-limits and request timeouts
// Progress persisted so sync can resume across invocations

const https = require('https');
const http = require('http');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');
const { buildHtmlDescription, downloadFile, attachVideoToProduct, FIELD_MAPPINGS } = require('./product-builder');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';
const API_VERSION = '2024-01';
const TYPE = 'jewelry';
const PROGRESS_FILE = '/tmp/sync_progress_jewelry.json';
const BATCH_SIZE = 50;
const PAGES_PER_RUN = 1;

function logInfo(runId, message, extra = null) {
  if (extra !== null) {
    console.log(`[SYNC-JEWELRY][${runId}] ${message}`, extra);
    return;
  }
  console.log(`[SYNC-JEWELRY][${runId}] ${message}`);
}

function logError(runId, message, extra = null) {
  if (extra !== null) {
    console.error(`[SYNC-JEWELRY][${runId}] ${message}`, extra);
    return;
  }
  console.error(`[SYNC-JEWELRY][${runId}] ${message}`);
}

function safeSnippet(value, maxLen = 250) {
  if (!value) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function parsePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

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
        // JSON parse failed
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

async function createProduct(item, accessToken, runId) {
  const title = item.remarks || item.jew_type || 'Jewelry';

  // Build organized characteristics table
  const description = buildHtmlDescription(item, FIELD_MAPPINGS.jewelry);

  // Collect images (3 image links)
  const imageUrls = [];
  const pushImage = (url, alt) => {
    if (!url) return;
    if (!imageUrls.find(i => i.src === url)) imageUrls.push(alt ? { src: url, alt } : { src: url });
  };
  pushImage(item.ImageLink, `${item.jew_type || 'Jewelry'}`.trim());
  pushImage(item.ImageLink1);
  pushImage(item.ImageLink2);

  // Build tags from available fields
  const tags = ['belgiumdia', TYPE];
  ['section', 'jew_type', 'metal_type', 'style'].forEach(k => {
    const v = item[k];
    if (v) tags.push(String(v));
  });

  const price = parseFloat(item.price || item.Buy_Price) || 0;

  const variant = {
    sku: item.item,
    price,
    barcode: item.item,
    inventory_quantity: 1,
    requires_shipping: false,
    inventory_management: 'shopify'
  };

  const body = {
    product: {
      title,
      body_html: description,
      vendor: 'Belgiumdia',
      product_type: 'jewelry',
      tags: Array.from(new Set(tags)).slice(0, 250),
      status: 'active',
      published_scope: 'global',
      published_at: new Date().toISOString(),
      variants: [variant],
      images: imageUrls
    }
  };

  const options = {
    hostname: STORE_DOMAIN,
    path: `/admin/api/${API_VERSION}/products.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    }
  };

  try {
    const response = await makeRequest(options, body);

    if (response.status !== 201) {
      logError(runId, `Failed to create product SKU=${item.item} status=${response.status}`, safeSnippet(response.body));
      return null;
    }

    const productId = response.body.product.id;
    logInfo(runId, `Created product SKU=${item.item} ID=${productId}`);

    // Attach certificate PDF if available
    if (item.CertificateLink) {
      try {
        await attachCertificate(productId, item.CertificateLink, accessToken, runId);
      } catch (e) {
        logError(runId, `Could not attach certificate for SKU=${item.item}: ${e.message}`);
      }
    }

    // Attach video if available
    if (item.VideoLink) {
      try {
        await attachVideo(productId, item.VideoLink, accessToken, runId);
      } catch (e) {
        logError(runId, `Could not attach video for SKU=${item.item}: ${e.message}`);
      }
    }

    await addProductToCollection(productId, 'Jewelry', accessToken, runId);

    return response.body.product;
  } catch (e) {
    logError(runId, `Error creating product SKU=${item.item}: ${e.message}`);
    return null;
  }
}

// Attach certificate PDF to product
async function attachCertificate(productId, certificateUrl, accessToken, runId) {
  logInfo(runId, `Attaching certificate to product ${productId}`);

  try {
    const buffer = await downloadFile(certificateUrl, 50);
    logInfo(runId, `Certificate downloaded: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);

    const query = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id fileStatus }
          userErrors { field message }
        }
      }
    `;

    const options = {
      hostname: STORE_DOMAIN,
      path: `/admin/api/2024-10/graphql.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    };

    const fileData = buffer.toString('base64');
    const mutation = {
      query,
      variables: {
        files: [{
          originalSource: `data:application/pdf;base64,${fileData}`,
          alt: 'Certificate'
        }]
      }
    };

    const response = await makeRequest(options, mutation);
    if (response.body?.data?.fileCreate?.userErrors?.length > 0) {
      logError(runId, `Certificate upload error`, response.body.data.fileCreate.userErrors);
      return;
    }

    logInfo(runId, `Certificate attached successfully`);
  } catch (e) {
    logError(runId, `Certificate attachment failed: ${e.message}`);
  }
}

// Attach video to product
async function attachVideo(productId, videoUrl, accessToken, runId) {
  logInfo(runId, `Attaching video to product ${productId}`);
  try {
    const result = await attachVideoToProduct(productId, videoUrl, accessToken, STORE_DOMAIN);
    logInfo(runId, `Video attached (${result.mediaContentType}, ${result.mediaCount} media items)`);
  } catch (e) {
    logError(runId, `Video attachment failed: ${e.message}`);
  }
}

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

async function syncJewelry(runId, options = {}) {
  const maxCreates = parsePositiveInt(options.maxCreates, BATCH_SIZE, 1, BATCH_SIZE);
  logInfo(runId, '========== JEWELRY SYNC START ==========');
  const startTime = Date.now();
  
  let progress = loadProgress();
  logInfo(runId, 'Loaded progress', {
    current_page: progress.current_page,
    current_item_index: progress.current_item_index,
    total_created: progress.total_items_created,
    total_skipped: progress.total_items_skipped,
    max_creates_this_run: maxCreates,
  });

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
    let stoppedByLimit = false;

    while (pagesProcessedThisRun < PAGES_PER_RUN) {
      logInfo(runId, `Fetching page ${progress.current_page}`);
      const data = await fetchBelgiumdiaData(progress.current_page, BATCH_SIZE, runId);

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

      for (let i = progress.current_item_index; i < items.length; i++) {
        if (createdThisRun >= maxCreates) {
          stoppedByLimit = true;
          logInfo(runId, `Create limit reached for this run (${maxCreates})`);
          break;
        }

        const item = items[i];

        if (!item.item) {
          logInfo(runId, `Skipping item without SKU at index ${i}`);
          skippedThisRun++;
          progress.total_items_skipped++;
          continue;
        }

        const existing = await findProductBySku(item.item, accessToken, runId);
        
        if (existing) {
          logInfo(runId, `Product already exists, skipping SKU=${item.item}`);
          skippedThisRun++;
          progress.total_items_skipped++;
          progress.current_item_index = i + 1;
          saveProgress(progress);
          continue;
        }

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

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (stoppedByLimit) {
        saveProgress(progress);
        break;
      }

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
      status: stoppedByLimit ? 'LIMIT_REACHED' : 'PROGRESS',
      run_id: runId,
      limits: {
        max_create: maxCreates,
      },
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
    const headerMaxCreate = req.headers['x-max-create'] || req.headers['max-create'];
    const maxCreateInput = req.query.max_create ?? headerMaxCreate;
    const maxCreates = parsePositiveInt(maxCreateInput, BATCH_SIZE, 1, BATCH_SIZE);
    const result = await syncJewelry(runId, { maxCreates });
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
