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

// Prefer Admin access token if available, otherwise fall back to Basic auth
function getAuthHeaders() {
  const token = (process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
  if (token) {
    return { 'X-Shopify-Access-Token': token };
  }

  // fallback to basic auth if client id/secret are provided
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (clientId && clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    return { 'Authorization': `Basic ${credentials}` };
  }

  throw new Error('Missing Shopify credentials: set SHOPIFY_ACCESS_TOKEN or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET');
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
  const title = item.Name || `${item.Brand || ''} ${item.Model || ''}`.trim() || 'Product';

  // Build description from all available fields
  const descriptionParts = [];
  const add = (label, value) => { if (value || value === 0) descriptionParts.push(`${label}: ${value}`); };
  add('Brand', item.Brand);
  add('Model', item.Model);
  add('MM', item.MM);
  add('Metal', item.Metal);
  add('Bracelet', item.Bracelet);
  add('Dial', item.Dial);
  add('Bezel', item.Bezel);
  add('Condition', item.Condition);
  add('Links', item.Links);
  add('Box', item.Box);
  add('Paper', item.Paper);
  add('Reference', item.Reference);
  add('Year', item.Year);
  add('Comment', item.Comment);
  add('Movement', item.Movement);
  add('Case', item.Case);
  add('Availability', item.Availability);
  add('DnaLink', item.DnaLink);
  add('VideoLink', item.VideoLink);
  add('Price', item.Price || item.Buy_Price);

  const description = descriptionParts.join(' | ');

  const reqOptions = {
    hostname: STORE_DOMAIN,
    path: `/admin/api/${API_VERSION}/products.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    }
  };

  const price = parseFloat(item.Price || item.Buy_Price) || 0;

  let inventoryQuantity = 1;
  if (item.Availability) {
    const parsed = parseInt(String(item.Availability).replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(parsed) && parsed >= 0) inventoryQuantity = parsed;
  }

  // Collect images and videos for media array
  const imageUrls = [];
  const mediaArray = [];
  const pushImage = (url, alt) => { 
    if (!url) return; 
    if (!imageUrls.find(i => i.src === url)) {
      imageUrls.push(alt ? { src: url, alt } : { src: url });
      // Also add to media as image
      mediaArray.push({ media_type: 'image', src: url, alt: alt || '' });
    }
  };
  pushImage(item.ImageLink, `${item.Brand || ''} ${item.Model || ''}`.trim());
  pushImage(item.ImageLink1);
  pushImage(item.ImageLink2);
  
  // Add video to media if available
  if (item.VideoLink) {
    mediaArray.push({ 
      media_type: 'external_video', 
      src: item.VideoLink,
      alt: `${item.Brand || ''} ${item.Model || ''}`.trim()
    });
  }

  const optionNames = [];
  if (item.MM) optionNames.push('Size (MM)');
  if (item.Metal) optionNames.push('Metal');
  if (item.Bracelet) optionNames.push('Bracelet');

  const optionsArray = optionNames.map(n => ({ name: n }));

  const variant = {
    sku: item.Stock || item.Stock_No,
    price,
    barcode: item.Stock_No || item.Stock,
    inventory_quantity: inventoryQuantity,
    requires_shipping: true
  };
  if (item.MM) variant.option1 = item.MM;
  if (item.Metal) variant.option2 = item.Metal;
  if (item.Bracelet) variant.option3 = item.Bracelet;

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
      options: optionsArray,
      variants: [variant],
      images: imageUrls,
      media: mediaArray
    }
  };

  console.log('[TEST] Request body:', JSON.stringify(body, null, 2));
  // If caller requested a dry-run, return the payload without sending to Shopify
  if (item.__dry) {
    return { success: true, dry: true, payload: body };
  }

  try {
    const response = await makeRequest(reqOptions, body);
    console.log('[TEST] Response status:', response.status);
    console.log('[TEST] Response body:', JSON.stringify(response.body, null, 2));
    if (response.status !== 201) return { success: false, status: response.status, error: response.body };
    return { success: true, status: response.status, product_id: response.body.product.id, product_handle: response.body.product.handle };
  } catch (e) {
    console.error('[TEST] Request failed:', e.message);
    return { success: false, error: e.message };
  }
}

// Main test function
async function testCreateProduct(dry = false) {
  console.log('\n========== TEST: CREATE ONE PRODUCT ==========\n');
  
  try {
    // Step 1: Fetch one product
    const item = await fetchOneProduct();
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