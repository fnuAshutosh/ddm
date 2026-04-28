// Test endpoint - Creates ONE belgiumdia product to test Shopify API integration
const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

// Load .env.local if running locally (for local tests)
if (fs.existsSync(path.join(__dirname, '..', '.env.local'))) {
  const envPath = path.join(__dirname, '..', '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (!process.env[key]) process.env[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  });
}

const http = require('http');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';
const API_VERSION = '2024-01';
const API_VERSION_GRAPHQL = '2024-10';
const MAX_VIDEO_SIZE_MB = 20;

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
      if (typeof body === 'string') req.write(body);
      else req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Get Admin API access token (prefer env token, fall back to OAuth client_credentials like sync-belgiumdia does)
async function getAccessToken() {
  const configuredToken = (process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
  if (configuredToken) {
    console.log('[TEST] Using Admin API token from environment');
    return configuredToken;
  }

  const clientId = (process.env.SHOPIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('Missing SHOPIFY_ACCESS_TOKEN/SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET');
  }

  console.log('[TEST] Requesting fresh Admin API access token via OAuth (client_credentials)');

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
      console.log(`[TEST] Got access token (expires in ${response.body.expires_in || 86400}s)`);
      return response.body.access_token;
    } else {
      const errorDetail = response.body?.error || response.body?.errors || response.body || 'Unknown error';
      console.log('[TEST] Full response:', JSON.stringify(response, null, 2));
      throw new Error(`Token request failed (${response.status}): ${JSON.stringify(errorDetail)}`);
    }
  } catch (e) {
    console.error(`[TEST] Token request failed: ${e.message}`);
    throw e;
  }
}

// YouTube/Vimeo → EXTERNAL_VIDEO; direct file URLs (MP4 etc.) → VIDEO (Shopify-hosted)
function videoMediaContentType(url) {
  return /youtube\.com|youtu\.be|vimeo\.com/i.test(url) ? 'EXTERNAL_VIDEO' : 'VIDEO';
}

// Resolve redirect URL (follow HTTP redirects)
async function resolveFinalUrl(redirectUrl) {
  return new Promise((resolve, reject) => {
    const attemptResolve = (url, hopCount = 0) => {
      if (hopCount > 10) return reject(new Error('Too many redirects'));

      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'http:' ? http : https;
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD',
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      };

      const req = protocol.request(options, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          attemptResolve(new URL(res.headers.location, url).toString(), hopCount + 1);
        } else if (res.statusCode === 200) {
          resolve(url);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });

      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
      req.end();
    };

    attemptResolve(redirectUrl);
  });
}

// Download video to buffer
async function downloadVideo(videoUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(videoUrl);
    const protocol = url.protocol === 'http:' ? http : https;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };

    const req = protocol.request(options, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        downloadVideo(new URL(res.headers.location, videoUrl).toString()).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

      const chunks = [];
      let size = 0;

      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
          res.destroy();
          return reject(new Error('Exceeds 20MB'));
        }
        chunks.push(chunk);
      });

      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.end();
  });
}

// Create staged upload target
async function createStagedUpload(filename, fileSize, token) {
  const query = `
    mutation createStagedUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }
  `;

  const options = {
    hostname: STORE_DOMAIN,
    path: `/admin/api/${API_VERSION_GRAPHQL}/graphql.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    }
  };

  const response = await makeRequest(options, {
    query,
    variables: {
      input: [{
        resource: 'VIDEO',
        filename,
        mimeType: 'video/mp4',
        httpMethod: 'POST',
        fileSize: String(fileSize)
      }]
    }
  });

  if (response.status !== 200) throw new Error(`Staged upload: ${response.status}`);
  if (response.body.errors) throw new Error(`GraphQL: ${JSON.stringify(response.body.errors)}`);

  const errors = response.body.data.stagedUploadsCreate.userErrors;
  if (errors.length > 0) throw new Error(`Staged upload: ${JSON.stringify(errors)}`);

  return response.body.data.stagedUploadsCreate.stagedTargets[0];
}

// Upload to S3
async function uploadToS3(buffer, stagingTarget) {
  const boundary = '----FormBoundary' + Date.now();
  let bodyParts = [];

  stagingTarget.parameters.forEach(param => {
    bodyParts.push(`--${boundary}`);
    bodyParts.push(`Content-Disposition: form-data; name="${param.name}"`);
    bodyParts.push('');
    bodyParts.push(param.value);
  });

  bodyParts.push(`--${boundary}`);
  bodyParts.push(`Content-Disposition: form-data; name="file"; filename="video.mp4"`);
  bodyParts.push('Content-Type: video/mp4');
  bodyParts.push('');

  const headerPart = bodyParts.join('\r\n') + '\r\n';
  const footerPart = `\r\n--${boundary}--\r\n`;

  const url = new URL(stagingTarget.url);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(headerPart) + buffer.length + Buffer.byteLength(footerPart)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if ([200, 204].includes(res.statusCode)) {
          resolve(stagingTarget.resourceUrl);
        } else {
          reject(new Error(`S3 upload: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(headerPart);
    req.write(buffer);
    req.write(footerPart);
    req.end();
  });
}

// Attach video via staged upload + productCreateMedia
async function attachVideoWithStagedUpload(productId, videoUrl, token) {
  try {
    console.log('[TEST] Resolving video URL...');
    const finalUrl = await resolveFinalUrl(videoUrl);

    console.log('[TEST] Downloading video...');
    const videoBuffer = await downloadVideo(finalUrl);
    console.log(`[TEST] Downloaded ${(videoBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    console.log('[TEST] Creating staged upload...');
    const stagingTarget = await createStagedUpload('product_video.mp4', videoBuffer.length, token);

    console.log('[TEST] Uploading to S3...');
    const resourceUrl = await uploadToS3(videoBuffer, stagingTarget);

    console.log('[TEST] Attaching video to product...');
    const attachQuery = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          product { id media(first: 10) { edges { node { id alt mediaContentType } } } }
          userErrors { field message }
        }
      }
    `;

    const attachOptions = {
      hostname: STORE_DOMAIN,
      path: `/admin/api/${API_VERSION_GRAPHQL}/graphql.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token
      }
    };

    const attachResponse = await makeRequest(attachOptions, {
      query: attachQuery,
      variables: {
        productId,
        media: [{
          originalSource: resourceUrl,
          alt: 'Product Video',
          mediaContentType: 'VIDEO'
        }]
      }
    });

    if (attachResponse.status !== 200) throw new Error(`Attach: ${attachResponse.status}`);
    if (attachResponse.body.errors) throw new Error(`GraphQL: ${JSON.stringify(attachResponse.body.errors)}`);

    const attachErrors = attachResponse.body.data.productCreateMedia.userErrors;
    if (attachErrors.length > 0) throw new Error(`Attach: ${JSON.stringify(attachErrors)}`);

    const mediaCount = attachResponse.body.data.productCreateMedia.product.media.edges.length;
    console.log(`[TEST] Video attached successfully (${mediaCount} media items)`);
    return true;
  } catch (e) {
    console.log(`[TEST] Warning: Could not attach video: ${e.message}`);
    return false;
  }
}

// Fetch ONE item from belgiumdia
async function fetchOneProduct() {
  console.log('[TEST] Fetching one product from belgiumdia...');
  
  try {
    const url = new URL(PROXY_URL);
    url.searchParams.append('type', 'natural');
    url.searchParams.append('page', '1');
    url.searchParams.append('limit', '1');

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Proxy returned ${response.status}`);
    
    const data = await response.json();
    const item = (data.items || [])[0];
    
    if (!item) throw new Error('No items returned from proxy');
    
    console.log('[TEST] Got product:', item.Stock_No, item.Shape, item.Weight);
    return item;
  } catch (e) {
    console.error('[TEST] Failed to fetch product:', e.message);
    throw e;
  }
}

// Build HTML description with organized characteristics table
function buildHtmlDescription(item) {
  const rows = [];
  const addRow = (label, value) => { if (value || value === 0) rows.push({ label, value }); };

  addRow('Brand', item.Brand);
  addRow('Model', item.Model);
  addRow('Size (MM)', item.MM);
  addRow('Metal', item.Metal);
  addRow('Bracelet', item.Bracelet);
  addRow('Dial', item.Dial);
  addRow('Bezel', item.Bezel);
  addRow('Condition', item.Condition);
  addRow('Links', item.Links);
  addRow('Box', item.Box);
  addRow('Paper', item.Paper);
  addRow('Reference', item.Reference);
  addRow('Year of Production', item.Year);
  addRow('Comment', item.Comment);
  addRow('Movement', item.Movement);
  addRow('Case', item.Case);
  addRow('Availability', item.Availability);

  let html = `
<style>
  .product-characteristics {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .product-characteristics th {
    background-color: #8B1A1A;
    color: #fff;
    padding: 12px;
    text-align: left;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 1px;
  }
  .product-characteristics td {
    padding: 12px;
    border-bottom: 1px solid #e5e5e5;
    font-size: 14px;
  }
  .product-characteristics tr:hover {
    background-color: #f9f9f9;
  }
  .product-characteristics td:first-child {
    color: #666;
    font-weight: 500;
    width: 35%;
  }
</style>

<h2 style="margin-top: 30px; font-size: 18px; font-weight: 600;">PRODUCT CHARACTERISTICS</h2>

<table class="product-characteristics">
  <thead>
    <tr>
      <th>CHARACTERISTIC</th>
      <th>DETAILS</th>
    </tr>
  </thead>
  <tbody>`;

  rows.forEach(row => {
    html += `
    <tr>
      <td>${row.label}</td>
      <td>${row.value}</td>
    </tr>`;
  });

  html += `
  </tbody>
</table>`;

  if (item.DnaLink) {
    html += `<p style="margin-top: 20px; color: #666;"><a href="${item.DnaLink}" target="_blank">View on DNA</a></p>`;
  }

  return html;
}

// Create product in Shopify
async function createProductInShopify(item) {
  console.log('[TEST] Creating product in Shopify...');
  const title = item.Name || `${item.Brand || ''} ${item.Model || ''}`.trim() || 'Product';

  const description = buildHtmlDescription(item);

  const price = parseFloat(item.Price || item.Buy_Price) || 0;

  let inventoryQuantity = 1;
  if (item.Availability) {
    const parsed = parseInt(String(item.Availability).replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(parsed) && parsed >= 0) inventoryQuantity = parsed;
  }

  // Collect images (preserve order, skip duplicates)
  const imageUrls = [];
  const pushImage = (url, alt) => { 
    if (!url) return; 
    if (!imageUrls.find(i => i.src === url)) {
      imageUrls.push(alt ? { src: url, alt } : { src: url });
    }
  };
  pushImage(item.ImageLink, `${item.Brand || ''} ${item.Model || ''}`.trim());
  pushImage(item.ImageLink1);
  pushImage(item.ImageLink2);

  const variant = {
    sku: item.Stock || item.Stock_No,
    price,
    barcode: item.Stock_No || item.Stock,
    inventory_quantity: inventoryQuantity,
    requires_shipping: true,
    inventory_management: 'shopify'
  };

  const tags = ['belgiumdia', 'test'];
  ['Brand','Model','Reference','Condition','Case','Movement','Year'].forEach(k => { const v = item[k]; if (v) tags.push(String(v)); });

  const body = {
    product: {
      title,
      body_html: description,
      vendor: 'Belgiumdia',
      product_type: 'test',
      tags: Array.from(new Set(tags)).slice(0,250),
      status: 'active',
      published_scope: 'global',
      published_at: new Date().toISOString(),
      variants: [variant],
      images: imageUrls
    }
  };

  console.log('[TEST] Request body:', JSON.stringify(body, null, 2));
  if (item.__dry) {
    return { success: true, dry: true, payload: body };
  }

  const accessToken = await getAccessToken();

  const reqOptions = {
    hostname: STORE_DOMAIN,
    path: `/admin/api/${API_VERSION}/products.json`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken }
  };

  try {
    const response = await makeRequest(reqOptions, body);
    console.log('[TEST] Response status:', response.status);
    console.log('[TEST] Response body:', JSON.stringify(response.body, null, 2));
    if (response.status !== 201) return { success: false, status: response.status, error: response.body };
    
    const productId = response.body.product.id;
    const productHandle = response.body.product.handle;
    
    // Attach video if VideoLink exists
    if (item.VideoLink) {
      const productGid = `gid://shopify/Product/${productId}`;
      await attachVideoWithStagedUpload(productGid, item.VideoLink, accessToken);
    }
    
    return { success: true, status: response.status, product_id: productId, product_handle: productHandle };
  } catch (e) {
    console.error('[TEST] Request failed:', e.message);
    return { success: false, error: e.message };
  }
}

// Main test function
async function testCreateProduct(dry = false, directProduct = null) {
  console.log('\n========== TEST: CREATE ONE PRODUCT ==========\n');

  try {
    // Step 1: Get product (either from parameter or fetch)
    let item = directProduct || await fetchOneProduct();
    if (dry) item.__dry = true;

    // Step 2: Create in Shopify
    const result = await createProductInShopify(item);

    console.log('\n========== TEST COMPLETE ==========\n');
    return result;
  } catch (e) {
    console.error('[TEST] FATAL ERROR:', e.message);
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version,X-Response-Time,X-Request-Id');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // If query ?mock=1 is provided, use an embedded sample item for testing
    const query = req.query || {};
    if (query.mock === '1') {
      const SAMPLE_ITEM = {
        Stock: '10005',
        Brand: 'ROLEX',
        Model: 'OYSTERDATE',
        MM: '34',
        Metal: 'STEEL',
        Bracelet: 'JUBILEE',
        Dial: 'SILVER',
        Bezel: 'SMOOTH',
        Condition: 'MINT',
        Links: '-5',
        Box: 'NO',
        Paper: 'NO',
        Reference: '6694',
        Year: '',
        Comment: 'NAKED',
        Movement: 'AUTOMATIC',
        Case: 'STEEL',
        Availability: 'G',
        Price: '4500',
        DnaLink: 'https://dna.dnalinks.in/w/10005',
        VideoLink: 'https://dnalinks.in/10005.mp4',
        ImageLink: 'https://dnalinks.in/10005.jpg',
        ImageLink1: 'https://dnalinks.in/10005_1.jpg',
        ImageLink2: 'https://dnalinks.in/10005_2.jpg'
      };

      if (query.dry === '1') SAMPLE_ITEM.__dry = true;

      const result = await createProductInShopify(SAMPLE_ITEM);
      res.status(200).json(result);
      return;
    }

    const result = await testCreateProduct(query.dry === '1');
    res.status(200).json(result);
  } catch (e) {
    console.error('Handler error:', e);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
};

// Run directly if executed from command line
if (require.main === module) {
  const directProduct = process.env.DIRECT_PRODUCT ? JSON.parse(process.env.DIRECT_PRODUCT) : null;
  testCreateProduct(false, directProduct)
    .then(result => {
      console.log('\nResult:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(e => {
      console.error('FATAL:', e);
      process.exit(1);
    });
}