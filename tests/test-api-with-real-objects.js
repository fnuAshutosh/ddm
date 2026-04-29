// Test sync-core with REAL belgiumdia objects from our test files
// Compares if API handles objects same way tests do

const { buildHtmlDescription, FIELD_MAPPINGS } = require('../api/product-builder');
const { SYNC_CONFIG } = require('../api/sync-config');

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║  API VERIFICATION: Real belgiumdia Objects             ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// REAL WATCH OBJECT from belgiumdia
const watchItem = {
  Stock: '3226',
  Stock_No: '3226',
  Brand: 'ROLEX',
  Model: 'OYSTER PERPETUAL',
  MM: '26',
  Metal: 'STEEL',
  Bracelet: 'OYSTER',
  Dial: 'SILVER',
  Bezel: 'SMOOTH',
  Condition: 'PRE OWNED',
  Links: 'FULL',
  Box: 'NO',
  Paper: 'NO',
  Reference: '6718',
  Year: '',
  Comment: 'NAKED',
  Movement: 'AUTOMATIC',
  Case: 'STEEL',
  Availability: '5',
  Price: '3300',
  Buy_Price: '3300',
  DnaLink: 'https://dna.dnalinks.in/w/3226',
  ImageLink: 'https://dnalinks.in/3226.jpg',
  ImageLink1: 'https://dnalinks.in/3226_1.jpg',
  ImageLink2: 'https://dnalinks.in/3226_2.jpg',
  VideoLink: 'https://dnalinks.in/3226.mp4'
};

// REAL LAB OBJECT
const labItem = {
  Stock_No: '885943',
  Shape: 'OVAL',
  Weight: '1.91',
  Diamond_Type: 'LAB GROWN',
  Color: 'D',
  Clarity: 'VVS1',
  Cut_Grade: 'Excellent',
  Buy_Price: '1299',
  Memo_Price: '1299',
  Lab: 'IGI',
  ImageLink: 'https://dnalinks.in/885943/still.jpg',
  ImageLink1: 'https://dnalinks.in/885943_1.jpg',
  ImageLink2: 'https://dnalinks.in/885943_2.jpg',
  VideoLink: 'https://dnalinks.in/885943/video.mp4',
  CertificateLink: 'https://dnalinks.in/certificate_images/LG756508823.pdf'
};

// REAL NATURAL OBJECT
const naturalItem = {
  Stock_No: '15718',
  Shape: 'MARQUISE',
  Weight: '0.5',
  Color: 'D',
  Clarity: 'VS1',
  Cut_Grade: 'Good',
  Buy_Price: '495',
  Memo_Price: '515',
  Lab: 'GIA',
  ImageLink: 'https://dnalinks.in/15718/still.jpg',
  ImageLink1: 'https://dnalinks.in/15718_1.jpg',
  ImageLink2: 'https://dnalinks.in/15718_2.jpg',
  VideoLink: 'https://dnalinks.in/15718/video.mp4',
  CertificateLink: 'https://dnalinks.in/certificate_images/2205049759.pdf'
};

// REAL JEWELRY OBJECT (with array images and video field)
const jewelryItem = {
  master_item: '7002572',
  item: '7002572',
  subitem: 'NK240012-RI-17I',
  section: 'NECKLACE',
  jew_type: 'RIVIERA',
  remarks: '14K White Round Diamond Riviera Necklace',
  metal_type: '14W',
  metal_weight: '12.67',
  diamond_weight: '8.41',
  diamond_pcs: '181',
  size_inch: '17',
  price: '6197',
  images: [
    'https://dnalinks.in/7002572/1W.jpg',
    'https://dnalinks.in/7002572/2W.jpg',
    'https://dnalinks.in/7002572/3W.jpg',
    'https://dnalinks.in/7002572/4W.jpg'
  ],
  video: 'https://dnalinks.in/7002572/VW.mp4'
};

function testProductCreation(name, item, cfg) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Testing: ${name}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  try {
    // TEST 1: SKU extraction (API logic)
    const sku = item[cfg.skuField];
    if (!sku) throw new Error(`SKU missing (field: ${cfg.skuField})`);
    console.log(`✓ SKU extracted: ${sku}`);

    // TEST 2: Title generation (API logic)
    const title = cfg.titleFn(item);
    if (!title || title.length === 0) throw new Error('Title generation failed');
    console.log(`✓ Title generated: ${title}`);

    // TEST 3: Price extraction with fallback (API logic)
    const price = parseFloat(item[cfg.priceFields[0]] || item[cfg.priceFields[1]]) || 0;
    if (price === 0) throw new Error('Price extraction failed');
    console.log(`✓ Price extracted: $${price}`);

    // TEST 4: Description building (API logic - CRITICAL)
    const description = buildHtmlDescription(item, cfg.fieldMappings) + cfg.extraHtmlFn(item);
    if (!description || description.length < 100) throw new Error('Description too short or missing');
    const hasTable = description.includes('product-characteristics');
    if (!hasTable) throw new Error('Description missing characteristics table');
    console.log(`✓ Description built: ${description.length} chars with characteristics table`);

    // TEST 5: Image extraction (API logic - HANDLES BOTH FORMATS)
    const imageUrls = [];
    const pushImage = (url, alt) => {
      if (!url) return;
      if (!imageUrls.find(i => i.src === url)) {
        imageUrls.push(alt ? { src: url, alt } : { src: url });
      }
    };

    if (Array.isArray(item.images)) {
      item.images.forEach(img => pushImage(img));
      console.log(`✓ Images extracted from array: ${imageUrls.length} images`);
    } else {
      pushImage(item.ImageLink, cfg.imageAltFn(item));
      pushImage(item.ImageLink1);
      pushImage(item.ImageLink2);
      console.log(`✓ Images extracted from fields: ${imageUrls.length} images`);
    }

    if (imageUrls.length === 0) throw new Error('No images extracted');

    // TEST 6: Video extraction (API logic - HANDLES BOTH FIELDS)
    const videoUrl = item.VideoLink || item.video;
    if (!videoUrl) throw new Error('Video URL not found');
    console.log(`✓ Video extracted: ${videoUrl.substring(0, 50)}...`);

    // TEST 7: Inventory calculation (API logic)
    const inventory = cfg.inventoryFn(item);
    if (!Number.isFinite(inventory)) throw new Error('Inventory calculation failed');
    console.log(`✓ Inventory calculated: ${inventory}`);

    // TEST 8: Certificate requirement (API logic)
    if (cfg.hasCertificate && item.CertificateLink) {
      console.log(`✓ Certificate required and present: ${item.CertificateLink.substring(0, 50)}...`);
    } else if (cfg.hasCertificate) {
      console.log(`⚠ Certificate required but not present`);
    } else {
      console.log(`✓ Certificate not required for this type`);
    }

    // TEST 9: Tag generation (API logic)
    const tags = ['belgiumdia', cfg.type];
    cfg.tagFields.forEach(field => {
      const value = item[field];
      if (value) tags.push(String(value));
    });
    console.log(`✓ Tags generated: ${tags.length} tags (${tags.join(', ').substring(0, 50)}...)`);

    // TEST 10: Product body structure (what would be sent to Shopify)
    const productBody = {
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
          barcode: typeof cfg.barcodeField === 'function' ? cfg.barcodeField(item) : item[cfg.barcodeField],
          inventory_quantity: inventory,
          requires_shipping: cfg.requiresShipping,
          inventory_management: 'shopify'
        }],
        images: imageUrls
      }
    };

    // Validate product body structure
    if (!productBody.product.title) throw new Error('Product body missing title');
    if (!productBody.product.body_html) throw new Error('Product body missing body_html');
    if (!productBody.product.variants[0].sku) throw new Error('Product body missing SKU');
    if (!productBody.product.images || productBody.product.images.length === 0) throw new Error('Product body missing images');

    console.log(`✓ Product body structure valid`);
    console.log(`\n✅ ${name} PASSED ALL TESTS\n`);
    return true;

  } catch (e) {
    console.log(`\n❌ ${name} FAILED: ${e.message}\n`);
    return false;
  }
}

// Run all tests
let passed = 0;
let failed = 0;

if (testProductCreation('WATCH with standard fields', watchItem, SYNC_CONFIG.watch)) passed++; else failed++;
if (testProductCreation('LAB with standard fields', labItem, SYNC_CONFIG.lab)) passed++; else failed++;
if (testProductCreation('NATURAL with standard fields', naturalItem, SYNC_CONFIG.natural)) passed++; else failed++;
if (testProductCreation('JEWELRY with array images + video field', jewelryItem, SYNC_CONFIG.jewelry)) passed++; else failed++;

console.log(`╔════════════════════════════════════════════════════════╗`);
console.log(`║  FINAL RESULTS                                        ║`);
console.log(`╚════════════════════════════════════════════════════════╝`);
console.log(`✓ Passed: ${passed}`);
console.log(`✗ Failed: ${failed}`);
console.log(`Total:   ${passed + failed}\n`);

process.exit(failed > 0 ? 1 : 0);
