// Verify refactored sync architecture loads correctly
const path = require('path');

console.log('Verifying refactored sync architecture...\n');

try {
  console.log('✓ Loading sync-config.js...');
  const { SYNC_CONFIG } = require('./api/sync-config');
  console.log(`  - watch config: ${SYNC_CONFIG.watch.type}`);
  console.log(`  - lab config: ${SYNC_CONFIG.lab.type}`);
  console.log(`  - natural config: ${SYNC_CONFIG.natural.type}`);
  console.log(`  - jewelry config: ${SYNC_CONFIG.jewelry.type}`);

  console.log('\n✓ Loading sync-core.js...');
  const { syncProducts } = require('./api/sync-core');
  console.log(`  - syncProducts function exists: ${typeof syncProducts === 'function'}`);

  console.log('\n✓ Loading sync handlers...');
  const syncWatch = require('./api/sync-watch');
  const syncLab = require('./api/sync-lab');
  const syncNatural = require('./api/sync-natural');
  const syncJewelry = require('./api/sync-jewelry');
  console.log(`  - sync-watch handler: ${typeof syncWatch === 'function'}`);
  console.log(`  - sync-lab handler: ${typeof syncLab === 'function'}`);
  console.log(`  - sync-natural handler: ${typeof syncNatural === 'function'}`);
  console.log(`  - sync-jewelry handler: ${typeof syncJewelry === 'function'}`);

  console.log('\n✓ Loading product-builder.js...');
  const { attachCertificate, attachVideoToProduct } = require('./api/product-builder');
  console.log(`  - attachCertificate: ${typeof attachCertificate === 'function'}`);
  console.log(`  - attachVideoToProduct: ${typeof attachVideoToProduct === 'function'}`);

  console.log('\n✅ All modules load successfully!');
  console.log('\nRefactoring complete:');
  console.log('  - sync-config.js: NEW (type-specific configurations)');
  console.log('  - sync-core.js: NEW (shared orchestration logic)');
  console.log('  - sync-watch/lab/natural/jewelry.js: REFACTORED (thin handlers)');
  console.log('  - product-builder.js: UPDATED (attachCertificate added)');
} catch (e) {
  console.error('❌ Error:', e.message);
  process.exit(1);
}
