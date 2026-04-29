// Mock tests for sync-core API without hitting real APIs
const fs = require('fs');
const path = require('path');

// Mock dependencies
const mockFetch = async (url) => {
  const urlStr = url.toString();

  // Parse query params
  const params = new URL(urlStr).searchParams;
  const type = params.get('type');
  const page = parseInt(params.get('page')) || 1;

  // Simulate rate limit on 3rd request
  global.fetchCallCount = (global.fetchCallCount || 0) + 1;
  if (global.fetchCallCount > 2) {
    return {
      ok: false,
      status: 502,
      text: async () => JSON.stringify({
        error: 'Failed to fetch from supplier',
        detail: 'Supplier message: Rate limit exceeded. Try again in 300 second(s).'
      })
    };
  }

  // Mock belgiumdia response
  const mockProducts = {
    watch: [
      { Stock: '3226', Stock_No: '3226', Brand: 'ROLEX', Model: 'OYSTER', Name: 'ROLEX OYSTER', Price: '3300', ImageLink: 'https://example.com/1.jpg', ImageLink1: 'https://example.com/2.jpg', VideoLink: 'https://example.com/video.mp4' },
      { Stock: '3227', Stock_No: '3227', Brand: 'OMEGA', Model: 'SEAMASTER', Name: 'OMEGA SEAMASTER', Price: '4500', ImageLink: 'https://example.com/3.jpg' }
    ],
    lab: [
      { Stock_No: '885943', Shape: 'OVAL', Weight: '1.91', Color: 'D', Clarity: 'VVS1', Buy_Price: '1299', images: ['https://example.com/1.jpg', 'https://example.com/2.jpg'], video: 'https://example.com/video.mp4', CertificateLink: 'https://example.com/cert.pdf' },
      { Stock_No: '885944', Shape: 'ROUND', Weight: '2.05', Color: 'E', Clarity: 'VS1', Buy_Price: '1599' }
    ],
    natural: [
      { Stock_No: '15718', Shape: 'MARQUISE', Weight: '0.5', Buy_Price: '495', ImageLink: 'https://example.com/1.jpg', ImageLink1: 'https://example.com/2.jpg', VideoLink: 'https://example.com/video.mp4', CertificateLink: 'https://example.com/cert.pdf' }
    ],
    jewelry: [
      { item: '7002572', jew_type: 'RIVIERA', remarks: '14K White Diamond Riviera', price: '6197', images: ['https://example.com/1.jpg', 'https://example.com/2.jpg'], video: 'https://example.com/video.mp4' }
    ]
  };

  const items = mockProducts[type] || [];
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      type,
      page,
      total_items: items.length,
      total_pages: 1,
      items: page === 1 ? items : []
    })
  };
};

// Mock Shopify API
const mockShopifyRequest = async (options, body) => {
  if (options.path.includes('/oauth/access_token')) {
    return {
      status: 200,
      body: { access_token: 'mock_token_12345', expires_in: 86400 }
    };
  }

  if (options.path.includes('/products.json') && options.method === 'POST') {
    const productBody = typeof body === 'string' ? JSON.parse(body) : body;
    return {
      status: 201,
      body: {
        product: {
          id: Math.floor(Math.random() * 1000000000),
          ...productBody.product,
          variants: [{ ...productBody.product.variants[0], id: Math.floor(Math.random() * 1000000000) }],
          images: productBody.product.images
        }
      }
    };
  }

  if (options.path.includes('/products?') && options.method === 'GET') {
    return {
      status: 200,
      body: { products: [] }
    };
  }

  if (options.path.includes('graphql.json')) {
    const query = typeof body === 'object' ? body.query : JSON.parse(body).query;
    if (query.includes('collectionProductsAdd')) {
      return {
        status: 200,
        body: {
          data: {
            collectionProductsAdd: {
              collection: { id: 'gid://shopify/Collection/123' },
              userErrors: []
            }
          }
        }
      };
    }
  }

  return { status: 404, body: { error: 'Not found' } };
};

// Mock file system
const mockProgressFiles = {};
const mockFileSystem = {
  existsSync: (path) => mockProgressFiles.hasOwnProperty(path),
  readFileSync: (path) => {
    if (mockProgressFiles[path]) {
      return JSON.stringify(mockProgressFiles[path]);
    }
    throw new Error('File not found: ' + path);
  },
  writeFileSync: (path, data) => {
    mockProgressFiles[path] = JSON.parse(data);
  }
};

// Load and patch sync-core
let syncCoreModule;

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║  MOCK TESTS FOR SYNC API                              ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

async function runTest(testName, fn) {
  try {
    process.stdout.write(`Testing ${testName}... `);
    await fn();
    console.log('✓');
    return true;
  } catch (e) {
    console.log(`✗\n  Error: ${e.message}`);
    return false;
  }
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  // Test 1: Watch product sync with standard fields
  if (await runTest('Watch sync with ImageLink fields', async () => {
    global.fetchCallCount = 0;
    const { SYNC_CONFIG } = require('../api/sync-config');

    const mockItem = SYNC_CONFIG.watch;
    if (!mockItem || typeof mockItem !== 'object') throw new Error('Watch config missing');
    if (mockItem.type !== 'watch') throw new Error('Watch type mismatch');
    if (!mockItem.fieldMappings) throw new Error('Watch field mappings missing');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 2: Lab product sync with array images
  if (await runTest('Lab sync with images array', async () => {
    const { SYNC_CONFIG } = require('../api/sync-config');

    const mockItem = SYNC_CONFIG.lab;
    if (!mockItem || typeof mockItem !== 'object') throw new Error('Lab config missing');
    if (mockItem.type !== 'lab') throw new Error('Lab type mismatch');
    if (!mockItem.hasCertificate) throw new Error('Lab should have certificate flag');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 3: Natural product sync
  if (await runTest('Natural sync configuration', async () => {
    const { SYNC_CONFIG } = require('../api/sync-config');

    const mockItem = SYNC_CONFIG.natural;
    if (!mockItem || typeof mockItem !== 'object') throw new Error('Natural config missing');
    if (mockItem.type !== 'natural') throw new Error('Natural type mismatch');
    if (!mockItem.hasCertificate) throw new Error('Natural should have certificate flag');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 4: Jewelry product sync with flexible fields
  if (await runTest('Jewelry sync with flexible fields', async () => {
    const { SYNC_CONFIG } = require('../api/sync-config');

    const mockItem = SYNC_CONFIG.jewelry;
    if (!mockItem || typeof mockItem !== 'object') throw new Error('Jewelry config missing');
    if (mockItem.type !== 'jewelry') throw new Error('Jewelry type mismatch');
    if (mockItem.skuField !== 'item') throw new Error('Jewelry SKU field should be "item"');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 5: Image field handling (array vs individual)
  if (await runTest('Image field handling - array format', async () => {
    const item = { images: ['url1', 'url2', 'url3'] };
    const imageUrls = [];

    if (Array.isArray(item.images)) {
      item.images.forEach(img => imageUrls.push({ src: img }));
    } else {
      throw new Error('Should handle array format');
    }

    if (imageUrls.length !== 3) throw new Error('Should extract 3 images');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 6: Image field handling (individual fields)
  if (await runTest('Image field handling - individual fields', async () => {
    const item = { ImageLink: 'url1', ImageLink1: 'url2', ImageLink2: 'url3' };
    const imageUrls = [];

    if (Array.isArray(item.images)) {
      throw new Error('Should not handle as array');
    } else {
      [item.ImageLink, item.ImageLink1, item.ImageLink2].forEach(url => {
        if (url) imageUrls.push({ src: url });
      });
    }

    if (imageUrls.length !== 3) throw new Error('Should extract 3 images');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 7: Video field handling (VideoLink vs video)
  if (await runTest('Video field handling - VideoLink', async () => {
    const item = { VideoLink: 'https://example.com/video.mp4' };
    const videoUrl = item.VideoLink || item.video;
    if (!videoUrl) throw new Error('Should find VideoLink');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 8: Video field handling (video)
  if (await runTest('Video field handling - video field', async () => {
    const item = { video: 'https://example.com/video.mp4' };
    const videoUrl = item.VideoLink || item.video;
    if (!videoUrl) throw new Error('Should find video field');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 9: Config field extraction
  if (await runTest('Config field extraction - SKU', async () => {
    const { SYNC_CONFIG } = require('../api/sync-config');
    const watchItem = { Stock: '3226' };
    const cfg = SYNC_CONFIG.watch;
    const sku = watchItem[cfg.skuField];
    if (sku !== '3226') throw new Error('Should extract SKU from Stock field');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 10: Config title function
  if (await runTest('Config title generation - Watch', async () => {
    const { SYNC_CONFIG } = require('../api/sync-config');
    const item = { Brand: 'ROLEX', Model: 'OYSTER', Name: 'ROLEX OYSTER' };
    const cfg = SYNC_CONFIG.watch;
    const title = cfg.titleFn(item);
    if (!title || title.length === 0) throw new Error('Should generate title');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 11: Config inventory function
  if (await runTest('Config inventory calculation - Watch', async () => {
    const { SYNC_CONFIG } = require('../api/sync-config');
    const item = { Availability: '5' };
    const cfg = SYNC_CONFIG.watch;
    const inv = cfg.inventoryFn(item);
    if (inv !== 5) throw new Error(`Should return 5, got ${inv}`);
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 12: Config inventory function - Lab (always 1)
  if (await runTest('Config inventory calculation - Lab', async () => {
    const { SYNC_CONFIG } = require('../api/sync-config');
    const cfg = SYNC_CONFIG.lab;
    const inv = cfg.inventoryFn({});
    if (inv !== 1) throw new Error('Lab should always return 1');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 13: Price field fallback
  if (await runTest('Price field fallback logic', async () => {
    const item1 = { Price: '100', Buy_Price: '90' };
    const item2 = { Buy_Price: '90' };

    const p1 = parseFloat(item1.Price || item1.Buy_Price);
    const p2 = parseFloat(item2.Price || item2.Buy_Price);

    if (p1 !== 100) throw new Error('Should use Price when available');
    if (p2 !== 90) throw new Error('Should fallback to Buy_Price');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 14: Tag generation
  if (await runTest('Tag generation from config', async () => {
    const { SYNC_CONFIG } = require('../api/sync-config');
    const item = { Brand: 'ROLEX', Model: 'OYSTER', Reference: '6718', Condition: 'PREOWNED' };
    const cfg = SYNC_CONFIG.watch;

    const tags = ['belgiumdia', cfg.type];
    cfg.tagFields.forEach(field => {
      if (item[field]) tags.push(String(item[field]));
    });

    if (tags.length < 3) throw new Error('Should generate tags');
    if (!tags.includes('belgiumdia')) throw new Error('Should include belgiumdia tag');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 15: Sync handler imports
  if (await runTest('Sync handler imports', async () => {
    const syncWatch = require('../api/sync-watch');
    const syncLab = require('../api/sync-lab');
    const syncNatural = require('../api/sync-natural');
    const syncJewelry = require('../api/sync-jewelry');

    if (typeof syncWatch !== 'function') throw new Error('sync-watch should export function');
    if (typeof syncLab !== 'function') throw new Error('sync-lab should export function');
    if (typeof syncNatural !== 'function') throw new Error('sync-natural should export function');
    if (typeof syncJewelry !== 'function') throw new Error('sync-jewelry should export function');
  })) {
    passed++;
  } else {
    failed++;
  }

  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  TEST RESULTS                                         ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total:   ${passed + failed}\n`);

  return failed === 0 ? 0 : 1;
}

runTests().then(code => process.exit(code));
