#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

// Load .env.local
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const match = trimmed.match(/^([^=]+)=["']?([^"']*)["']?$/);
    if (match) {
      const [, key, value] = match;
      process.env[key] = value.replace(/^["']|["']$/g, '');
    }
  }
});

console.log('✓ Loaded env vars from .env.local');
console.log(`  SHOPIFY_CLIENT_ID: ${process.env.SHOPIFY_CLIENT_ID ? '***' : 'NOT SET'}`);
console.log(`  SHOPIFY_CLIENT_SECRET: ${process.env.SHOPIFY_CLIENT_SECRET ? '***' : 'NOT SET'}`);
console.log(`  SHOPIFY_STORE_DOMAIN: ${process.env.SHOPIFY_STORE_DOMAIN || 'NOT SET'}`);

// OAuth exchange: client credentials -> access token
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

async function getAccessToken() {
  console.log('\n[AUTH] Exchanging client credentials for access token...');
  
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  
  if (!clientId || !clientSecret || !storeDomain) {
    throw new Error('Missing SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, or SHOPIFY_STORE_DOMAIN');
  }

  const tokenBody = querystring.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'write_products,read_products'
  });

  const options = {
    hostname: storeDomain,
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
      const token = response.body.access_token;
      console.log(`✓ Got access token (expires in ${response.body.expires_in || 86400}s)`);
      return token;
    } else {
      const errorDetail = response.body?.error || response.body?.errors || 'Unknown error';
      throw new Error(`Token request failed (${response.status}): ${JSON.stringify(errorDetail)}`);
    }
  } catch (e) {
    console.error(`✗ Token request failed: ${e.message}`);
    throw e;
  }
}

// Import handler
const handler = require('./api/test-create-product.js');

async function runTest() {
  try {
    // Step 1: Get access token via OAuth
    const accessToken = await getAccessToken();
    
    // Step 2: Mock request for real create (no dry-run)
    const req = { method: 'GET', query: { mock: '1' } };
    
    // Inject access token into env so handler can use it
    process.env.SHOPIFY_ACCESS_TOKEN = accessToken;

    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { 
        console.log('\n========== RESPONSE ==========');
        console.log(JSON.stringify(obj, null, 2)); 
      },
      end() { console.log('\n========== END =========='); }
    };

    console.log('\n========== TESTING LIVE PRODUCT CREATE ==========\n');
    
    // Step 3: Create product using access token
    await handler(req, res);
  } catch (e) {
    console.error('\n✗ TEST FAILED:', e.message);
    process.exit(1);
  }
}

// Run the test
runTest();
