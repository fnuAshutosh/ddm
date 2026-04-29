// Watch Sync - Uses exact same logic as working tests
const https = require('https');
const fs = require('fs');
const querystring = require('querystring');
const { buildHtmlDescription, downloadFile, attachVideoToProduct, FIELD_MAPPINGS } = require('./product-builder');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const API_VERSION = '2024-01';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
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
    console.log(`[${runId}] Using Admin API token from environment`);
    return configuredToken;
  }

  const clientId = (process.env.SHOPIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('Missing credentials');
  }

  const tokenBody = querystring.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'write_products,write_files,write_themes'
  });

  const response = await makeRequest({
    hostname: STORE_DOMAIN,
    path: '/admin/oauth/access_token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(tokenBody)
    }
  }, tokenBody);

  if (response.status !== 200 || !response.body?.access_token) {
    throw new Error(`Token failed: ${response.status}`);
  }

  console.log(`[${runId}] Got access token`);
  return response.body.access_token;
}

async function createWatchProduct(item, accessToken, runId) {
  try {
    // Build product exactly like working tests do
    const title = item.Name || `${item.Brand || ''} ${item.Model || ''}`.trim() || 'Watch';
    const description = buildHtmlDescription(item, FIELD_MAPPINGS.watch);

    // Collect images - handle both array and individual fields
    const imageUrls = [];
    const pushImage = (url, alt) => {
      if (!url) return;
      if (!imageUrls.find(i => i.src === url)) imageUrls.push(alt ? { src: url, alt } : { src: url });
    };

    if (Array.isArray(item.images)) {
      item.images.forEach(img => pushImage(img));
    } else {
      pushImage(item.ImageLink, `${item.Brand || ''} ${item.Model || ''}`.trim());
      pushImage(item.ImageLink1);
      pushImage(item.ImageLink2);
    }

    let inventory = 1;
    if (item.Availability) {
      const parsed = parseInt(String(item.Availability).replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(parsed) && parsed > 0) inventory = parsed;
    }

    const tags = ['belgiumdia', 'watch', item.Brand, item.Model, item.Reference, item.Condition, item.Case, item.Movement, item.Year];

    const body = {
      product: {
        title,
        body_html: description,
        vendor: 'Belgiumdia',
        product_type: 'watch',
        tags: Array.from(new Set(tags.filter(t => t))).slice(0, 250),
        status: 'active',
        published_scope: 'global',
        published_at: new Date().toISOString(),
        variants: [{
          sku: item.Stock || item.Stock_No,
          price: parseFloat(item.Price || item.Buy_Price),
          barcode: item.Stock_No || item.Stock,
          inventory_quantity: inventory,
          requires_shipping: true,
          inventory_management: 'shopify'
        }],
        images: imageUrls
      }
    };

    const response = await makeRequest({
      hostname: STORE_DOMAIN,
      path: `/admin/api/${API_VERSION}/products.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    }, body);

    if (response.status !== 201) {
      console.error(`[${runId}] Create failed: ${response.status}`);
      return null;
    }

    const productId = response.body.product.id;
    console.log(`[${runId}] Created watch: SKU=${item.Stock || item.Stock_No}, ID=${productId}, Images=${imageUrls.length}`);

    // Attach video if present - handle both VideoLink and video field
    const videoUrl = item.VideoLink || item.video;
    if (videoUrl) {
      try {
        const result = await attachVideoToProduct(productId, videoUrl, accessToken, STORE_DOMAIN);
        console.log(`[${runId}] Video attached: ${result.mediaContentType}`);
      } catch (e) {
        console.error(`[${runId}] Video attachment failed: ${e.message}`);
      }
    }

    return { id: productId, sku: item.Stock || item.Stock_No };
  } catch (error) {
    console.error(`[${runId}] Product creation error: ${error.message}`);
    return null;
  }
}

module.exports = async (req, res) => {
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Sync-Run-Id', runId);

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const maxCreate = parseInt(req.query.max_create || '50', 10);
    const maxCreates = Math.min(Math.max(maxCreate, 1), 50);

    console.log(`[${runId}] Watch sync started - max_create=${maxCreates}`);

    const accessToken = await getAccessToken(runId);

    // Load progress
    const progressFile = '/tmp/sync_progress_watch.json';
    let progress = { current_page: 1, current_index: 0, total_created: 0 };
    if (fs.existsSync(progressFile)) {
      progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    }

    // Fetch from belgiumdia
    const url = new URL(PROXY_URL);
    url.searchParams.append('type', 'watch');
    url.searchParams.append('page', progress.current_page);
    url.searchParams.append('limit', 50);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!Array.isArray(data.items)) {
      throw new Error('Invalid belgiumdia response');
    }

    const items = data.items;
    let created = 0;
    let failed = 0;

    // Process items
    for (let i = progress.current_index; i < items.length && created < maxCreates; i++) {
      const item = items[i];
      const result = await createWatchProduct(item, accessToken, runId);

      if (result) {
        created++;
        progress.total_created++;
      } else {
        failed++;
      }

      progress.current_index = i + 1;
      fs.writeFileSync(progressFile, JSON.stringify(progress));

      // Cooldown between creates
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Update progress for next run
    if (progress.current_index >= items.length) {
      progress.current_page++;
      progress.current_index = 0;
    }
    fs.writeFileSync(progressFile, JSON.stringify(progress));

    res.status(200).json({
      success: true,
      run_id: runId,
      status: created >= maxCreates ? 'LIMIT_REACHED' : 'PROGRESS',
      session: { created, failed },
      progress: {
        current_page: progress.current_page,
        total_created: progress.total_created
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, run_id: runId, error: e.message });
  }
};
