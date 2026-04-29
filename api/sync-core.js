// Generic sync orchestration - shared across all product types
const https = require('https');
const fs = require('fs');
const { buildHtmlDescription, attachCertificate, attachVideoToProduct } = require('./product-builder');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';
const API_VERSION = '2024-01';
const BATCH_SIZE = 50;
const PAGES_PER_RUN = 1;

function logInfo(runId, message, extra = null) {
  if (extra !== null) {
    console.log(`[SYNC][${runId}] ${message}`, extra);
  } else {
    console.log(`[SYNC][${runId}] ${message}`);
  }
}

function logError(runId, message, extra = null) {
  if (extra !== null) {
    console.error(`[SYNC][${runId}] ${message}`, extra);
  } else {
    console.error(`[SYNC][${runId}] ${message}`);
  }
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

function loadProgress(progressFile) {
  try {
    if (fs.existsSync(progressFile)) {
      const data = fs.readFileSync(progressFile, 'utf8');
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

function saveProgress(progressFile, progress) {
  try {
    progress.last_updated = new Date().toISOString();
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2), 'utf8');
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
      if (typeof body === 'string') req.write(body);
      else req.write(JSON.stringify(body));
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
    throw new Error('Missing SHOPIFY_ACCESS_TOKEN or SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET');
  }

  const querystring = require('querystring');
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

  const response = await makeRequest(options, tokenBody);

  if (response.status === 200 && response.body?.access_token) {
    logInfo(runId, `Got access token (expires in ${response.body.expires_in || 86400}s)`);
    return response.body.access_token;
  } else {
    const errorDetail = response.body?.error || response.body?.errors || 'Unknown error';
    throw new Error(`Token request failed (${response.status}): ${JSON.stringify(errorDetail)}`);
  }
}

async function fetchBelgiumdiaData(productType, page = 1, limit = 50, runId) {
  logInfo(runId, `Fetching Belgiumdia ${productType} data`, { page, limit });

  try {
    const url = new URL(PROXY_URL);
    url.searchParams.append('type', productType);
    url.searchParams.append('page', page);
    url.searchParams.append('limit', limit);

    const response = await fetch(url.toString());
    const rawText = await response.text();

    if (!response.ok) {
      logError(runId, `Proxy returned ${response.status} for ${productType} page ${page}`, safeSnippet(rawText));

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
      type: productType,
      page,
      received_items: (data.items || []).length,
      total_pages: data.total_pages || null,
      cache_hit: Boolean(data.cache_hit),
      stale: Boolean(data.stale)
    });
    return data;
  } catch (e) {
    logError(runId, `Failed to fetch Belgiumdia data for ${productType} page ${page}: ${e.message}`);
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

async function createProduct(item, cfg, accessToken, runId) {
  const sku = item[cfg.skuField];
  const barcode = typeof cfg.barcodeField === 'function' ? cfg.barcodeField(item) : item[cfg.barcodeField];
  const price = parseFloat(item[cfg.priceFields[0]] || item[cfg.priceFields[1]]) || 0;
  const title = cfg.titleFn(item);
  const description = buildHtmlDescription(item, cfg.fieldMappings) + cfg.extraHtmlFn(item);
  const imageUrls = [];

  const pushImage = (url, alt) => {
    if (!url) return;
    if (!imageUrls.find(i => i.src === url)) {
      imageUrls.push(alt ? { src: url, alt } : { src: url });
    }
  };

  pushImage(item.ImageLink, cfg.imageAltFn(item));
  pushImage(item.ImageLink1);
  pushImage(item.ImageLink2);

  const tags = ['belgiumdia', cfg.type];
  cfg.tagFields.forEach(field => {
    const value = item[field];
    if (value) tags.push(String(value));
  });

  const variant = {
    sku,
    price,
    barcode,
    inventory_quantity: cfg.inventoryFn(item),
    requires_shipping: cfg.requiresShipping,
    inventory_management: 'shopify'
  };

  const body = {
    product: {
      title,
      body_html: description,
      vendor: 'Belgiumdia',
      product_type: cfg.productType,
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
      logError(runId, `Failed to create product SKU=${sku} status=${response.status}`, safeSnippet(response.body));
      return null;
    }

    const productId = response.body.product.id;
    logInfo(runId, `Created product SKU=${sku} ID=${productId}`);

    if (cfg.hasCertificate && item.CertificateLink) {
      try {
        await attachCertificate(productId, item.CertificateLink, accessToken, STORE_DOMAIN);
        logInfo(runId, `Certificate attached for SKU=${sku}`);
      } catch (e) {
        logError(runId, `Certificate attachment failed for SKU=${sku}: ${e.message}`);
      }
    }

    if (item.VideoLink) {
      try {
        const result = await attachVideoToProduct(productId, item.VideoLink, accessToken, STORE_DOMAIN);
        logInfo(runId, `Video attached (${result.mediaContentType}) for SKU=${sku}`);
      } catch (e) {
        logError(runId, `Video attachment failed for SKU=${sku}: ${e.message}`);
      }
    }

    await addProductToCollection(productId, cfg.collectionName, accessToken, runId);

    return response.body.product;
  } catch (e) {
    logError(runId, `Error creating product SKU=${sku}: ${e.message}`);
    return null;
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

async function syncProducts(productType, runId, options = {}, cfg) {
  const maxCreates = parsePositiveInt(options.maxCreateInput, BATCH_SIZE, 1, BATCH_SIZE);
  logInfo(runId, '========== SYNC START ==========');
  const startTime = Date.now();

  let progress = loadProgress(cfg.progressFile);
  logInfo(runId, 'Loaded progress', {
    current_page: progress.current_page,
    current_item_index: progress.current_item_index,
    total_created: progress.total_items_created,
    total_skipped: progress.total_items_skipped,
    max_creates_this_run: maxCreates
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
      const data = await fetchBelgiumdiaData(productType, progress.current_page, BATCH_SIZE, runId);

      if (data.error === 'RATE_LIMITED') {
        progress.cooldown_until = data.retry_after;
        saveProgress(cfg.progressFile, progress);
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
        const skuValue = item[cfg.skuField];

        if (!skuValue) {
          logInfo(runId, `Skipping item without SKU at index ${i}`);
          skippedThisRun++;
          progress.total_items_skipped++;
          continue;
        }

        const existing = await findProductBySku(skuValue, accessToken, runId);

        if (existing) {
          logInfo(runId, `Product already exists, skipping SKU=${skuValue}`);
          skippedThisRun++;
          progress.total_items_skipped++;
          progress.current_item_index = i + 1;
          saveProgress(cfg.progressFile, progress);
          continue;
        }

        const created = await createProduct(item, cfg, accessToken, runId);
        if (created) {
          createdThisRun++;
          progress.total_items_created++;
        } else {
          failedThisRun++;
          progress.total_items_failed++;
        }

        progress.current_item_index = i + 1;
        saveProgress(cfg.progressFile, progress);

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (stoppedByLimit) {
        saveProgress(cfg.progressFile, progress);
        break;
      }

      if (progress.current_page < totalPages) {
        progress.current_page++;
        progress.current_item_index = 0;
        pagesProcessedThisRun++;
        saveProgress(cfg.progressFile, progress);
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
        max_create: maxCreates
      },
      session: {
        created: createdThisRun,
        skipped: skippedThisRun,
        failed: failedThisRun,
        duration
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

module.exports = { syncProducts };
