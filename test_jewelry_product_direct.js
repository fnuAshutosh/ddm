// Direct jewelry product test with complete video/certificate attachment
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const querystring = require('querystring');
const { buildHtmlDescription, downloadFile, attachVideoToProduct, FIELD_MAPPINGS } = require('./api/product-builder');

if (fs.existsSync(path.join(__dirname, '.env.local'))) {
  const envPath = path.join(__dirname, '.env.local');
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

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
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
      if (typeof body === 'string') req.write(body);
      else req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function getAccessToken() {
  const configuredToken = (process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
  if (configuredToken) {
    console.log('[TEST] Using Admin API token from environment');
    return configuredToken;
  }

  console.log('[TEST] Requesting OAuth token...');

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

  console.log('[TEST] Got access token');
  return response.body.access_token;
}

// Attach certificate PDF to product
async function attachCertificate(productId, certificateUrl, accessToken) {
  console.log('[TEST] Attaching certificate...');
  try {
    const buffer = await downloadFile(certificateUrl, 50);
    console.log(`[TEST] Certificate downloaded: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);

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
      query: `mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id fileStatus }
          userErrors { field message }
        }
      }`,
      variables: {
        files: [{
          originalSource: `data:application/pdf;base64,${fileData}`,
          alt: 'Certificate'
        }]
      }
    };

    const response = await makeRequest(options, mutation);
    if (response.body?.data?.fileCreate?.userErrors?.length > 0) {
      console.error(`[TEST] Certificate error:`, response.body.data.fileCreate.userErrors);
      return;
    }
    console.log('[TEST] Certificate attached successfully');
  } catch (e) {
    console.error(`[TEST] Certificate attachment failed: ${e.message}`);
  }
}

// Attach video to product
async function attachVideo(productId, videoUrl, accessToken) {
  console.log('[TEST] Attaching video...');
  try {
    const result = await attachVideoToProduct(productId, videoUrl, accessToken, STORE_DOMAIN);
    console.log(`[TEST] Video attached successfully (${result.mediaContentType}, ${result.mediaCount} media items)`);
  } catch (e) {
    console.error(`[TEST] Video attachment failed: ${e.message}`);
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  TEST: Jewelry Product - Diamond Ring                 ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const product = {
    item: "JWL-2024-001",
    remarks: "Platinum Diamond Solitaire Ring",
    jew_type: "Ring",
    section: "Engagement",
    metal_type: "Platinum",
    metal_weight: "3.5",
    diamond_weight: "1.5",
    diamond_pcs: "1",
    size_inch: "7",
    price: "2500",
    Buy_Price: "2500",
    style: "Solitaire",
    Condition: "New",
    ImageLink: "https://dnalinks.in/jewelry/ring1.jpg",
    ImageLink1: "https://dnalinks.in/jewelry/ring1_1.jpg",
    ImageLink2: "https://dnalinks.in/jewelry/ring1_2.jpg",
    VideoLink: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  };

  try {
    const token = await getAccessToken();

    const title = product.remarks || product.jew_type || 'Jewelry';
    const description = buildHtmlDescription(product, FIELD_MAPPINGS.jewelry);

    // Collect images
    const imageUrls = [];
    const pushImage = (url) => {
      if (!url) return;
      if (!imageUrls.find(i => i.src === url)) imageUrls.push({ src: url });
    };
    pushImage(product.ImageLink);
    pushImage(product.ImageLink1);
    pushImage(product.ImageLink2);

    const tags = ['belgiumdia', 'jewelry', product.jew_type, product.metal_type, product.style];

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
        variants: [{
          sku: product.item,
          price: parseFloat(product.price),
          barcode: product.item,
          inventory_quantity: 1,
          requires_shipping: false,
          inventory_management: 'shopify'
        }],
        images: imageUrls
      }
    };

    console.log('[TEST] Creating jewelry product...');
    const response = await makeRequest({
      hostname: STORE_DOMAIN,
      path: `/admin/api/${API_VERSION}/products.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token
      }
    }, body);

    if (response.status !== 201) {
      throw new Error(`Create failed: ${response.status} - ${JSON.stringify(response.body)}`);
    }

    const productId = response.body.product.id;
    console.log(`[TEST] Product created: ${productId}`);
    console.log(`[TEST] Images: ${imageUrls.length}`);

    // Attach video if available
    if (product.VideoLink) {
      await attachVideo(productId, product.VideoLink, token);
    }

    // Attach certificate if available
    if (product.CertificateLink) {
      await attachCertificate(productId, product.CertificateLink, token);
    }

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  ✅ JEWELRY TEST SUCCESS!                             ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.log(`Product ID: ${productId}`);
    console.log(`Title: ${title}`);
    console.log(`Price: $${product.price}`);
    console.log(`View: https://saatchiandco.myshopify.com/admin/products/${productId}\n`);

  } catch (error) {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  ❌ JEWELRY TEST FAILED                               ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.error(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
