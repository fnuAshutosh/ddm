// Direct lab diamond product test
const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const { buildHtmlDescription, downloadFile, attachVideoToProduct, FIELD_MAPPINGS } = require('../api/product-builder');

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

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  TEST: Lab Diamond Product 885943                     ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const product = {
    Stock_No: "885943",
    Shape: "OVAL",
    Weight: "1.91",
    Color: "D",
    Clarity: "VVS2",
    Cut_Grade: "EX",
    Polish: "EX",
    Symmetry: "EX",
    Fluorescence_Intensity: "N",
    Measurements: "9.40 X 6.82 X 4.54",
    Lab: "IGI",
    Treatment: "CVD",
    DEPTH_PER: "66.6",
    TABLE_PER: "60",
    Pavilion_Angle: "41.1",
    Cert_Comments: "Lab Grown Diamond - High Quality",
    Report_Issue_Date: "12/11/2025",
    Diamond_Type: "Lab Grown",
    Ratio: "1.38",
    Buy_Price: "1299",
    ImageLink: "https://dnalinks.in/885943/still.jpg",
    ImageLink1: "https://dnalinks.in/885943_1.jpg",
    ImageLink2: "https://dnalinks.in/885943_2.jpg",
    VideoLink: "https://dnalinks.in/885943/video.mp4",
    CertificateLink: "https://dnalinks.in/certificate_images/LG756508823.pdf"
  };

  try {
    const token = await getAccessToken();

    const title = `${product.Shape} - ${product.Weight}ct`;
    const description = buildHtmlDescription(product, FIELD_MAPPINGS.lab);

    // Collect images
    const imageUrls = [];
    const pushImage = (url) => {
      if (!url) return;
      if (!imageUrls.find(i => i.src === url)) imageUrls.push({ src: url });
    };
    pushImage(product.ImageLink);
    pushImage(product.ImageLink1);
    pushImage(product.ImageLink2);

    const tags = ['belgiumdia', 'lab', product.Diamond_Type, product.Lab, product.Color, product.Clarity];

    const body = {
      product: {
        title,
        body_html: description,
        vendor: 'Belgiumdia',
        product_type: 'lab-diamond',
        tags: Array.from(new Set(tags)).slice(0, 250),
        status: 'active',
        published_scope: 'global',
        published_at: new Date().toISOString(),
        variants: [{
          sku: product.Stock_No,
          price: parseFloat(product.Buy_Price),
          barcode: product.Stock_No,
          inventory_quantity: 1,
          requires_shipping: false,
          inventory_management: 'shopify'
        }],
        images: imageUrls
      }
    };

    console.log('[TEST] Creating lab diamond product...');
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

    if (product.CertificateLink) {
      try {
        const buffer = await downloadFile(product.CertificateLink, 50);
        const fileData = buffer.toString('base64');
        const certResponse = await makeRequest({
          hostname: STORE_DOMAIN,
          path: `/admin/api/2024-10/graphql.json`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }
        }, {
          query: `mutation fileCreate($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id fileStatus } userErrors { field message } } }`,
          variables: { files: [{ originalSource: `data:application/pdf;base64,${fileData}`, alt: 'Certificate' }] }
        });
        const certErrors = certResponse.body?.data?.fileCreate?.userErrors || [];
        if (certErrors.length > 0) console.error('[TEST] Certificate error:', certErrors);
        else console.log('[TEST] Certificate attached');
      } catch (e) { console.error(`[TEST] Certificate failed: ${e.message}`); }
    }

    if (product.VideoLink) {
      try {
        const result = await attachVideoToProduct(productId, product.VideoLink, token, STORE_DOMAIN);
        console.log(`[TEST] Video attached (${result.mediaContentType}, ${result.mediaCount} media items)`);
      } catch (e) { console.error(`[TEST] Video failed: ${e.message}`); }
    }

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  ✅ LAB DIAMOND TEST SUCCESS!                        ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.log(`Product ID: ${productId}`);
    console.log(`Title: ${title}`);
    console.log(`Price: $${product.Buy_Price}`);
    console.log(`View: https://saatchiandco.myshopify.com/admin/products/${productId}\n`);

  } catch (error) {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  ❌ LAB DIAMOND TEST FAILED                           ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.error(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
