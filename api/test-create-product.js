// Test endpoint - Creates ONE belgiumdia product to test Shopify API integration
const https = require('https');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Get Basic Auth header
function getBasicAuth() {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET');
  }
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  return `Basic ${credentials}`;
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

// Create product in Shopify
async function createProductInShopify(item) {
  console.log('[TEST] Creating product in Shopify...');
  
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
      'Authorization': getBasicAuth()
    }
  };

  const body = {
    product: {
      title,
      body_html: description,
      vendor: 'Belgiumdia',
      product_type: 'natural',
      tags: ['belgiumdia', 'natural', 'test'],
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

  console.log('[TEST] Request body:', JSON.stringify(body, null, 2));

  try {
    const response = await makeRequest(options, body);
    
    console.log('[TEST] Response status:', response.status);
    console.log('[TEST] Response body:', JSON.stringify(response.body, null, 2));
    
    if (response.status !== 201) {
      return {
        success: false,
        status: response.status,
        error: response.body,
        details: 'Product creation failed - check API response above'
      };
    }

    return {
      success: true,
      status: response.status,
      product_id: response.body.product.id,
      product_handle: response.body.product.handle,
      details: 'Product created successfully!'
    };
  } catch (e) {
    console.error('[TEST] Request failed:', e.message);
    return {
      success: false,
      error: e.message
    };
  }
}

// Main test function
async function testCreateProduct() {
  console.log('\n========== TEST: CREATE ONE PRODUCT ==========\n');
  
  try {
    // Step 1: Fetch one product
    const item = await fetchOneProduct();
    
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
    const result = await testCreateProduct();
    res.status(200).json(result);
  } catch (e) {
    console.error('Handler error:', e);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
};