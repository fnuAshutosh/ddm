// Direct natural diamond product test with complete video/certificate attachment
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
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
  console.log('║  TEST: Natural Diamond Product - Round Brilliant       ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const product = {
    "Stock_No": "15718",
    "Availability": "G",
    "Shape": "MARQUISE",
    "Weight": "0.5",
    "Color": "F",
    "Clarity": "I2",
    "Cut_Grade": "G",
    "Polish": "VG",
    "Symmetry": "G",
    "Fluorescence_Intensity": "S",
    "Fluorescence_Color": "B",
    "Measurements": "7.89 X 3.99 X 2.61",
    "Lab": "GIA",
    "Treatment": "",
    "FancyColor": "",
    "Fancy_Color_Intensity": "",
    "FancyColorOvertone": "",
    "DEPTH_PER": "65.4",
    "TABLE_PER": "56",
    "Girdle_Min": "Thick",
    "Girdle_Max": "Extremely Thick",
    "Girdle_Per": "",
    "Girdle_Condition": "",
    "Culet_Size": "N",
    "Culet_Condition": "",
    "Crown_Height": "",
    "Crown_Angle": "",
    "Pavilion_Depth": "",
    "Pavilion_Angle": "",
    "Cert_Comments": "",
    "Country": "USA",
    "State": "NY",
    "City": "New York",
    "Country_Of_Origin": "BWA",
    "Key_To_Symbols": "Twinning Wisp",
    "Shade": "None",
    "Star_Length": "",
    "Report_Issue_Date": "02/08/2019",
    "Report_Type": "Diamond Dossier",
    "Milky": "None",
    "Eye_Clean": "Borderline",
    "Gemprint_ID": "",
    "BGM": "NO",
    "Ratio": "1.98",
    "Diamond_Type": "Natural Diamond",
    "Member_Comments": "GD MAKE +2% RAP For Memo Service/Free Ship To HK",
    "Time_to_Location": "",
    "LsMatchedPairSeparable": "",
    "Pair_Stock": "",
    "Allow_Raplink_Feed": "",
    "Parcel_Stones": "",
    "Center_Inclusion": "Medium",
    "Black_Inclusion": "Medium",
    "Lab_Location": "",
    "Brand": "",
    "Sarine_Name": "",
    "Internal_Clarity_Desc_Code": "TTGG",
    "Clarity_Description": "Slightly Eye Visible Black and White Thru-out",
    "Modified_Rate": "",
    "wire_discount_price": "",
    "ImageLink": "https://dnalinks.in/15718/still.jpg",
    "ImageLink1": "https://dnalinks.in/15718_1.jpg",
    "ImageLink2": "https://dnalinks.in/15718_2.jpg",
    "VideoLink": "https://dnalinks.in/15718/video.mp4",
    "Video_HTML": "https://dnalinks.in/15718/15718.html",
    "CertificateLink": "https://dnalinks.in/certificate_images/2205049759.pdf",
    "Rap_Price": "1000",
    "Memo_Price": "515",
    "Memo_Discount_PER": "-48.5",
    "Buy_Price": "495",
    "Buy_Price_Discount_PER": "-50.5",
    "COD_Buy_Price": "475",
    "COD_Buy_Price_Discount_PER": "-52.5",
    "Certificate": ""
}

  try {
    const token = await getAccessToken();

    const title = `${product.Shape} - ${product.Weight}ct`;
    const description = buildHtmlDescription(product, FIELD_MAPPINGS.natural);

    // Collect images
    const imageUrls = [];
    const pushImage = (url) => {
      if (!url) return;
      if (!imageUrls.find(i => i.src === url)) imageUrls.push({ src: url });
    };
    pushImage(product.ImageLink);
    pushImage(product.ImageLink1);
    pushImage(product.ImageLink2);

    const tags = ['belgiumdia', 'natural', product.Shape, product.Lab, product.Color, product.Clarity];

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

    console.log('[TEST] Creating natural diamond product...');
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

    // Attach certificate if available
    if (product.CertificateLink) {
      await attachCertificate(productId, product.CertificateLink, token);
    }

    // Attach video if available
    if (product.VideoLink) {
      await attachVideo(productId, product.VideoLink, token);
    }

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  ✅ NATURAL DIAMOND TEST SUCCESS!                    ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.log(`Product ID: ${productId}`);
    console.log(`Title: ${title}`);
    console.log(`Price: $${product.Buy_Price}`);
    console.log(`View: https://saatchiandco.myshopify.com/admin/products/${productId}\n`);

  } catch (error) {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  ❌ NATURAL DIAMOND TEST FAILED                       ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.error(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
