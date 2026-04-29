// Natural Diamond Sync - Uses exact same logic as working test-natural.js
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

async function attachCertificate(productId, certificateUrl, accessToken, runId) {
  try {
    const buffer = await downloadFile(certificateUrl, 50);
    const fileData = buffer.toString('base64');
    const certResponse = await makeRequest({
      hostname: STORE_DOMAIN,
      path: `/admin/api/2024-10/graphql.json`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken }
    }, {
      query: `mutation fileCreate($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id fileStatus } userErrors { field message } } }`,
      variables: { files: [{ originalSource: `data:application/pdf;base64,${fileData}`, alt: 'Certificate' }] }
    });
    const certErrors = certResponse.body?.data?.fileCreate?.userErrors || [];
    if (certErrors.length > 0) {
      console.error(`[${runId}] Certificate error:`, certErrors);
      return false;
    }
    console.log(`[${runId}] Certificate attached`);
    return true;
  } catch (e) {
    console.error(`[${runId}] Certificate failed: ${e.message}`);
    return false;
  }
}

async function createNaturalProduct(item, accessToken, runId) {
  try {
    // Build product exactly like test-natural.js does
    const title = `${item.Shape} - ${item.Weight}ct`;
    const description = buildHtmlDescription(item, FIELD_MAPPINGS.natural);

    // Collect images - handle both array and individual fields
    const imageUrls = [];
    const pushImage = (url) => {
      if (!url) return;
      if (!imageUrls.find(i => i.src === url)) imageUrls.push({ src: url });
    };

    if (Array.isArray(item.images)) {
      item.images.forEach(img => pushImage(img));
    } else {
      pushImage(item.ImageLink);
      pushImage(item.ImageLink1);
      pushImage(item.ImageLink2);
    }

    const tags = ['belgiumdia', 'natural', item.Shape, item.Lab, item.Color, item.Clarity];

    const body = {
      product: {
        title,
        body_html: description,
        vendor: 'Belgiumdia',
        product_type: 'natural-diamond',
        tags: Array.from(new Set(tags)).slice(0, 250),
        status: 'active',
        published_scope: 'global',
        published_at: new Date().toISOString(),
        variants: [{
          sku: item.Stock_No,
          price: parseFloat(item.Buy_Price),
          barcode: item.Stock_No,
          inventory_quantity: 1,
          requires_shipping: false,
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
    console.log(`[${runId}] Created natural product: SKU=${item.Stock_No}, ID=${productId}, Images=${imageUrls.length}`);

    // Attach certificate if present
    if (item.CertificateLink) {
      await attachCertificate(productId, item.CertificateLink, accessToken, runId);
    }

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

    return { id: productId, sku: item.Stock_No };
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

    console.log(`[${runId}] Natural sync started - max_create=${maxCreates}`);

    const accessToken = await getAccessToken(runId);

    // Load progress
    const progressFile = '/tmp/sync_progress_natural.json';
    let progress = { current_page: 1, current_index: 0, total_created: 0 };
    if (fs.existsSync(progressFile)) {
      progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    }

    // Fetch from belgiumdia
    const url = new URL(PROXY_URL);
    url.searchParams.append('type', 'natural');
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
      const result = await createNaturalProduct(item, accessToken, runId);

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
