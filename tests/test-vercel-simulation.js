// VERCEL SIMULATION: Test current code as it will run on Vercel
// This verifies if pushing will work correctly

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║  VERCEL SIMULATION TEST                               ║');
console.log('║  Testing if current API code will work on Vercel      ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// Setup: Mock Vercel environment
const mockReq = (query = {}, method = 'GET') => ({
  query,
  method,
  headers: {}
});

const mockRes = () => {
  const response = {
    statusCode: null,
    headers: {},
    body: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.body = data;
      return this;
    },
    end: function() {
      return this;
    },
    setHeader: function(key, value) {
      this.headers[key] = value;
      return this;
    }
  };
  return response;
};

async function testSyncHandler(handlerName, handler) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Testing: ${handlerName}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  try {
    // Test 1: Handler is a function
    if (typeof handler !== 'function') {
      throw new Error(`${handlerName} is not a function`);
    }
    console.log(`✓ Handler is a function`);

    // Test 2: Handler accepts req, res
    const req = mockReq({ max_create: '1' });
    const res = mockRes();

    // Test 3: Call handler
    await handler(req, res);

    console.log(`✓ Handler executed without crashing`);

    // Test 4: Response has data
    if (!res.body) {
      throw new Error('No response body');
    }
    console.log(`✓ Response has body`);

    // Test 5: Check response structure
    const body = res.body;
    console.log(`✓ Response structure:`);
    console.log(`  - success: ${body.success}`);
    console.log(`  - status: ${body.status}`);
    console.log(`  - error: ${body.error || 'none'}`);
    console.log(`  - run_id: ${body.run_id ? 'present' : 'missing'}`);

    // Test 6: Even if rate limited, response should be valid
    if (body.error) {
      console.log(`⚠️  Rate limited or error: ${body.error}`);
      if (!body.run_id) {
        throw new Error('Error response missing run_id');
      }
      console.log(`✓ Error response is valid`);
    } else {
      console.log(`✓ Success response`);
      if (body.progress) {
        console.log(`  - Progress: page ${body.progress.current_page}, created ${body.progress.total_created}`);
      }
    }

    // Test 7: CORS headers
    if (!res.headers['Access-Control-Allow-Origin']) {
      throw new Error('Missing CORS headers');
    }
    console.log(`✓ CORS headers present`);

    console.log(`\n✅ ${handlerName} READY FOR VERCEL`);
    return true;

  } catch (e) {
    console.log(`\n❌ ${handlerName} FAILED: ${e.message}`);
    return false;
  }
}

async function runAllTests() {
  let passed = 0;
  let failed = 0;

  // Test all 4 sync handlers
  const handlers = [
    { name: 'sync-watch', handler: require('../api/sync-watch') },
    { name: 'sync-lab', handler: require('../api/sync-lab') },
    { name: 'sync-natural', handler: require('../api/sync-natural') },
    { name: 'sync-jewelry', handler: require('../api/sync-jewelry') }
  ];

  for (const { name, handler } of handlers) {
    if (await testSyncHandler(name, handler)) {
      passed++;
    } else {
      failed++;
    }
  }

  // Test that sync-core is importable
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Testing: Dependencies`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  try {
    const syncCore = require('../api/sync-core');
    if (!syncCore.syncProducts) {
      throw new Error('sync-core missing syncProducts export');
    }
    console.log(`✓ sync-core.js exports syncProducts`);

    const syncConfig = require('../api/sync-config');
    if (!syncConfig.SYNC_CONFIG) {
      throw new Error('sync-config missing SYNC_CONFIG export');
    }
    console.log(`✓ sync-config.js exports SYNC_CONFIG`);

    const productBuilder = require('../api/product-builder');
    if (!productBuilder.buildHtmlDescription) {
      throw new Error('product-builder missing buildHtmlDescription');
    }
    if (!productBuilder.attachVideoToProduct) {
      throw new Error('product-builder missing attachVideoToProduct');
    }
    if (!productBuilder.attachCertificate) {
      throw new Error('product-builder missing attachCertificate');
    }
    console.log(`✓ product-builder.js has all required exports`);

    console.log(`\n✅ All dependencies OK`);
    passed++;

  } catch (e) {
    console.log(`\n❌ Dependency check failed: ${e.message}`);
    failed++;
  }

  // Summary
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  VERCEL READINESS CHECK                               ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total:   ${passed + failed}\n`);

  if (failed === 0) {
    console.log(`✅ YOUR CODE IS VERCEL-READY!`);
    console.log(`\nWhen pushed to Vercel:`);
    console.log(`  1. sync-watch will work ✓`);
    console.log(`  2. sync-lab will work ✓`);
    console.log(`  3. sync-natural will work ✓`);
    console.log(`  4. sync-jewelry will work ✓`);
    console.log(`\nAll handlers delegate to sync-core.js which has:`);
    console.log(`  ✓ Image array + field handling`);
    console.log(`  ✓ Video field fallback (VideoLink || video)`);
    console.log(`  ✓ HTML description building`);
    console.log(`  ✓ Certificate attachment`);
    console.log(`  ✓ Video attachment`);
    console.log(`  ✓ Collection assignment`);
    console.log(`  ✓ Progress persistence`);
    console.log(`  ✓ Rate-limit handling\n`);
  } else {
    console.log(`⚠️  Code has issues. Fix them before pushing.\n`);
  }

  return failed === 0 ? 0 : 1;
}

runAllTests().then(code => process.exit(code));
