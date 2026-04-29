// COMPARE: What the API would send to Shopify vs what Tests send
// This reveals if API is actually broken

const { buildHtmlDescription, FIELD_MAPPINGS } = require('../api/product-builder');
const { SYNC_CONFIG } = require('../api/sync-config');

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║  COMPARISON: Test sends vs API sends to Shopify       ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// REAL jewelry object (the one that failed)
const jewelryItem = {
  item: '7002572',
  jew_type: 'RIVIERA',
  remarks: '14K White Round Diamond Riviera Necklace',
  metal_type: '14W',
  metal_weight: '12.67',
  diamond_weight: '8.41',
  diamond_pcs: '181',
  price: '6197',
  images: [
    'https://dnalinks.in/7002572/1W.jpg',
    'https://dnalinks.in/7002572/2W.jpg',
    'https://dnalinks.in/7002572/3W.jpg',
    'https://dnalinks.in/7002572/4W.jpg'
  ],
  video: 'https://dnalinks.in/7002572/VW.mp4'
};

function buildTestProductBody(item) {
  // THIS IS WHAT test-jewelry.js DOES (WORKS)
  const title = item.remarks || item.jew_type || 'Jewelry';
  const description = buildHtmlDescription(item, FIELD_MAPPINGS.jewelry);

  const imageUrls = [];
  const pushImage = (url) => {
    if (!url) return;
    if (!imageUrls.find(i => i.src === url)) imageUrls.push({ src: url });
  };

  if (Array.isArray(item.images)) {
    item.images.forEach(img => pushImage(img));
  } else {
    pushImage(item.ImageLink);
    pushImage(item.ImageLink1);
    pushImage(item.ImageLink2);
  }

  const tags = ['belgiumdia', 'jewelry', item.jew_type, item.metal_type, item.style];

  return {
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
        sku: item.item,
        price: parseFloat(item.price),
        barcode: item.item,
        inventory_quantity: 1,
        requires_shipping: false,
        inventory_management: 'shopify'
      }],
      images: imageUrls
    }
  };
}

function buildAPIProductBody(item) {
  // THIS IS WHAT sync-core.js DOES (OUR API)
  const cfg = SYNC_CONFIG.jewelry;

  const sku = item[cfg.skuField];
  const barcode = typeof cfg.barcodeField === 'function' ? cfg.barcodeField(item) : item[cfg.barcodeField];
  const price = parseFloat(item[cfg.priceFields[0]] || item[cfg.priceFields[1]]) || 0;
  const title = cfg.titleFn(item);
  const description = buildHtmlDescription(item, cfg.fieldMappings) + cfg.extraHtmlFn(item);

  const imageUrls = [];
  const pushImage = (url, alt) => {
    if (!url) return;
    if (!imageUrls.find(i => i.src === url)) {
      imageUrls.push(alt ? { src: url, alt } : { src: url });
    }
  };

  if (Array.isArray(item.images)) {
    item.images.forEach(img => pushImage(img));
  } else {
    pushImage(item.ImageLink, cfg.imageAltFn(item));
    pushImage(item.ImageLink1);
    pushImage(item.ImageLink2);
  }

  const tags = ['belgiumdia', cfg.type];
  cfg.tagFields.forEach(field => {
    const value = item[field];
    if (value) tags.push(String(value));
  });

  return {
    product: {
      title,
      body_html: description,
      vendor: 'Belgiumdia',
      product_type: cfg.productType,
      tags: Array.from(new Set(tags)).slice(0, 250),
      status: 'active',
      published_scope: 'global',
      published_at: new Date().toISOString(),
      variants: [{
        sku,
        price,
        barcode,
        inventory_quantity: 1,
        requires_shipping: false,
        inventory_management: 'shopify'
      }],
      images: imageUrls
    }
  };
}

// Build both versions
const testBody = buildTestProductBody(jewelryItem);
const apiBody = buildAPIProductBody(jewelryItem);

// Compare
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST VERSION (test-jewelry.js) ✓');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Title: ${testBody.product.title}`);
console.log(`SKU: ${testBody.product.variants[0].sku}`);
console.log(`Price: $${testBody.product.variants[0].price}`);
console.log(`Images: ${testBody.product.images.length}`);
testBody.product.images.forEach((img, i) => {
  console.log(`  [${i+1}] ${img.src}`);
});
console.log(`Description: ${testBody.product.body_html.length} chars`);
console.log(`  Has HTML table: ${testBody.product.body_html.includes('product-characteristics')}`);
console.log(`  Has <table>: ${testBody.product.body_html.includes('<table')}`);
console.log(`  Has <style>: ${testBody.product.body_html.includes('<style')}`);
console.log(`Tags: ${testBody.product.tags.length} (${testBody.product.tags.join(', ')})`);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('API VERSION (sync-core.js) - Our Refactor');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Title: ${apiBody.product.title}`);
console.log(`SKU: ${apiBody.product.variants[0].sku}`);
console.log(`Price: $${apiBody.product.variants[0].price}`);
console.log(`Images: ${apiBody.product.images.length}`);
apiBody.product.images.forEach((img, i) => {
  console.log(`  [${i+1}] ${img.src}`);
});
console.log(`Description: ${apiBody.product.body_html.length} chars`);
console.log(`  Has HTML table: ${apiBody.product.body_html.includes('product-characteristics')}`);
console.log(`  Has <table>: ${apiBody.product.body_html.includes('<table')}`);
console.log(`  Has <style>: ${apiBody.product.body_html.includes('<style')}`);
console.log(`Tags: ${apiBody.product.tags.length} (${apiBody.product.tags.join(', ')})`);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('DIFFERENCES?');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let differences = 0;

if (testBody.product.title !== apiBody.product.title) {
  console.log(`✗ TITLE DIFFERENT`);
  console.log(`  Test: ${testBody.product.title}`);
  console.log(`  API:  ${apiBody.product.title}`);
  differences++;
} else {
  console.log(`✓ Title: SAME`);
}

if (testBody.product.variants[0].sku !== apiBody.product.variants[0].sku) {
  console.log(`✗ SKU DIFFERENT`);
  differences++;
} else {
  console.log(`✓ SKU: SAME`);
}

if (testBody.product.variants[0].price !== apiBody.product.variants[0].price) {
  console.log(`✗ PRICE DIFFERENT`);
  differences++;
} else {
  console.log(`✓ Price: SAME`);
}

if (testBody.product.images.length !== apiBody.product.images.length) {
  console.log(`✗ IMAGE COUNT DIFFERENT: Test=${testBody.product.images.length}, API=${apiBody.product.images.length}`);
  differences++;
} else {
  console.log(`✓ Images: SAME (${testBody.product.images.length})`);
}

if (testBody.product.body_html.length !== apiBody.product.body_html.length) {
  console.log(`✗ DESCRIPTION LENGTH DIFFERENT: Test=${testBody.product.body_html.length} chars, API=${apiBody.product.body_html.length} chars`);
  differences++;
} else {
  console.log(`✓ Description length: SAME (${testBody.product.body_html.length} chars)`);
}

const testHasHTML = testBody.product.body_html.includes('<table');
const apiHasHTML = apiBody.product.body_html.includes('<table');
if (testHasHTML !== apiHasHTML) {
  console.log(`✗ DESCRIPTION FORMAT DIFFERENT: Test has HTML=${testHasHTML}, API has HTML=${apiHasHTML}`);
  differences++;
} else {
  console.log(`✓ Description format: SAME (HTML=${testHasHTML})`);
}

if (testBody.product.tags.length !== apiBody.product.tags.length) {
  console.log(`✗ TAG COUNT DIFFERENT: Test=${testBody.product.tags.length}, API=${apiBody.product.tags.length}`);
  console.log(`  Test tags: ${testBody.product.tags.join(', ')}`);
  console.log(`  API tags:  ${apiBody.product.tags.join(', ')}`);
  differences++;
} else {
  console.log(`✓ Tags: SAME (${testBody.product.tags.length})`);
}

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  CONCLUSION                                           ║`);
console.log(`╚════════════════════════════════════════════════════════╝`);

if (differences === 0) {
  console.log(`✅ TEST AND API SEND IDENTICAL DATA TO SHOPIFY`);
  console.log(`   Both have: images, HTML description, all fields`);
  console.log(`   If products were created WITHOUT these, Vercel has OLD code!`);
} else {
  console.log(`⚠️  DIFFERENCES FOUND: ${differences}`);
  console.log(`   Test and API send DIFFERENT data`);
  console.log(`   This could explain missing images/videos/descriptions`);
}

console.log();
