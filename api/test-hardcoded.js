// Hardcoded test - Creates a test product without depending on belgiumdia API
const https = require('https');
const querystring = require('querystring');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const API_VERSION = '2024-01';

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
async function getAccessToken() {
  const configuredToken = (process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
  if (configuredToken) {
    console.log('[AUTH] Using Admin API token from environment');
    return configuredToken;
  }

  console.log('[AUTH] Exchanging Client ID/Secret for Admin API access token...');
  
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
    hostname: 'saatchiandco.myshopify.com',
    path: '/admin/oauth/access_token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(tokenBody)
    }
  };

  console.log(`[AUTH] POST https://${options.hostname}${options.path}`);
  
  try {
    const response = await makeRequest(options, tokenBody);
    
    console.log(`[AUTH] Response status: ${response.status}`);
    
    if (response.status === 200 && response.body?.access_token) {
      const token = response.body.access_token;
      console.log(`[AUTH] ✅ Got access token: ${token.substring(0, 20)}...`);
      return token;
    } else {
      console.log(`[AUTH] Error response:`, JSON.stringify(response.body, null, 2));
      throw new Error(`Failed to get access token: ${response.status} ${JSON.stringify(response.body)}`);
    }
  } catch (e) {
    console.error('[AUTH] Failed:', e.message);
    throw e;
  }
}

// Create product in Shopify (hardcoded test data)
async function createTestProduct(accessToken) {
  console.log('[PRODUCT] Creating test product in Shopify...');
  
  // Hardcoded belgiumdia-style product
  const testProduct = {
    Stock_No: 'TEST-' + Date.now(),
    Shape: 'Round',
    Weight: '1.50',
    Color: 'D',
    Clarity: 'IF',
    Cut_Grade: 'Excellent',
    Polish: 'Excellent',
    Symmetry: 'Excellent',
    Lab: 'GIA',
    Buy_Price: '8500',
    ImageLink: 'https://via.placeholder.com/500?text=Belgiumdia+Diamond'
  };

  const title = `${testProduct.Shape} - ${testProduct.Weight}ct`;
  const description = [
    `Color: ${testProduct.Color}`,
    `Clarity: ${testProduct.Clarity}`,
    `Cut: ${testProduct.Cut_Grade}`,
    `Polish: ${testProduct.Polish}`,
    `Symmetry: ${testProduct.Symmetry}`,
    `Lab: ${testProduct.Lab}`
  ].join(' | ');

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
      product_type: 'natural',
      tags: ['belgiumdia', 'natural', 'test-hardcoded'],
      status: 'active',
      variants: [
        {
          sku: testProduct.Stock_No,
          price: parseFloat(testProduct.Buy_Price),
          barcode: testProduct.Stock_No,
          inventory_quantity: 1,
          requires_shipping: false
        }
      ],
      images: [{ src: testProduct.ImageLink }]
    }
  };

  console.log(`[PRODUCT] Creating product: "${title}"`);
  console.log(`[PRODUCT] SKU: ${testProduct.Stock_No}`);
  console.log(`[PRODUCT] Price: $${testProduct.Buy_Price}`);

  try {
    const response = await makeRequest(options, body);
    
    console.log(`[PRODUCT] Response status: ${response.status}`);
    
    if (response.status === 201) {
      const product = response.body.product;
      console.log(`[PRODUCT] ✅ SUCCESS - Product created!`);
      console.log(`[PRODUCT] Product ID: ${product.id}`);
      console.log(`[PRODUCT] Handle: ${product.handle}`);
      
      return {
        success: true,
        status: response.status,
        product_id: product.id,
        product_handle: product.handle,
        title: product.title,
        sku: product.variants[0].sku,
        price: product.variants[0].price,
        message: '✅ Product created successfully in Shopify!',
        shop_url: `https://${STORE_DOMAIN}/admin/products/${product.id}`
      };
    } else {
      console.log(`[PRODUCT] ❌ FAILED - Status: ${response.status}`);
      console.log(`[PRODUCT] Error details:`, JSON.stringify(response.body, null, 2));
      
      return {
        success: false,
        status: response.status,
        error: response.body,
        message: 'Product creation failed - check error details above'
      };
    }
  } catch (e) {
    console.error('[PRODUCT] Request failed:', e.message);
    return {
      success: false,
      error: e.message,
      message: 'Request error - check error message above'
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
    console.log('[HANDLER] Starting test product creation...');
    
    // Step 1: Get access token
    const accessToken = await getAccessToken();
    
    // Step 2: Create product
    const result = await createTestProduct(accessToken);
    
    res.status(200).json(result);
  } catch (e) {
    console.error('[HANDLER] Error:', e.message);
    res.status(500).json({
      success: false,
      error: e.message,
      message: 'Handler error'
    });
  }
};