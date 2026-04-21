// Test Complete Product - Creates ONE belgiumdia product with ALL fields
const https = require('https');
const querystring = require('querystring');

const STORE_DOMAIN = 'saatchiandco.myshopify.com';
const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';
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
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function getAccessToken() {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  
  const tokenBody = querystring.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'write_products,read_products'
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
  
  if (response.status !== 200) throw new Error('Token failed');
  return response.body.access_token;
}

async function fetchOneProduct() {
  const url = new URL(PROXY_URL);
  url.searchParams.append('type', 'natural');
  url.searchParams.append('page', '1');
  url.searchParams.append('limit', '1');
  
  const response = await fetch(url.toString());
  const data = await response.json();
  return (data.items || [])[0];
}

async function createCompleteProductInShopify(item, accessToken) {
  const title = `${item.Shape} ${item.Weight}ct - ${item.Color}/${item.Clarity}`;
  
  const metafields = [
    { namespace: 'diamond', key: 'stock_no', value: item.Stock_No, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'shape', value: item.Shape, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'weight', value: item.Weight, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'color', value: item.Color, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'clarity', value: item.Clarity, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'cut', value: item.Cut_Grade, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'polish', value: item.Polish, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'symmetry', value: item.Symmetry, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'depth_pct', value: item.DEPTH_PER, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'table_pct', value: item.TABLE_PER, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'measurements', value: item.Measurements, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'lab', value: item.Lab, type: 'single_line_text_field' },
    { namespace: 'diamond', key: 'origin', value: item.Country_Of_Origin, type: 'single_line_text_field' },
    { namespace: 'pricing', key: 'rap_price', value: item.Rap_Price, type: 'single_line_text_field' }
  ];

  const buyPrice = parseFloat(item.Buy_Price) || 0;
  const rapPrice = parseFloat(item.Rap_Price) || buyPrice;

  const body = {
    product: {
      title,
      body_html: `<strong>${title}</strong><br/>Cut: ${item.Cut_Grade}, Polish: ${item.Polish}, Symmetry: ${item.Symmetry}<br/>Depth: ${item.DEPTH_PER}%, Table: ${item.TABLE_PER}%<br/>Lab: ${item.Lab} | Date: ${item.Report_Issue_Date}`,
      vendor: 'Belgiumdia',
      product_type: 'Natural Diamond',
      tags: ['belgiumdia', 'natural-diamond', item.Shape.toLowerCase(), item.Color.toLowerCase()],
      status: 'active',
      metafields,
      variants: [{
        sku: item.Stock_No,
        barcode: item.Stock_No,
        price: buyPrice.toFixed(2),
        compare_at_price: rapPrice > buyPrice ? rapPrice.toFixed(2) : null,
        inventory_quantity: 1,
        requires_shipping: true,
        weight: parseFloat(item.Weight),
        weight_unit: 'g'
      }],
      images: item.ImageLink ? [{ src: item.ImageLink, alt: title }] : []
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
  
  if (response.status !== 201) return { success: false, error: response.body };
  
  const product = response.body.product;
  return {
    success: true,
    product_id: product.id,
    title: product.title,
    sku: product.variants[0].sku,
    price: product.variants[0].price,
    compare_at_price: product.variants[0].compare_at_price,
    metafields_count: metafields.length,
    shop_url: `https://${STORE_DOMAIN}/admin/products/${product.id}`,
    message: '✅ Complete product created with all diamond specs and metafields!'
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  try {
    const accessToken = await getAccessToken();
    const item = await fetchOneProduct();
    const result = await createCompleteProductInShopify(item, accessToken);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};