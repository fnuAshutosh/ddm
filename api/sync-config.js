// Product type configuration for generic sync
const { FIELD_MAPPINGS } = require('./product-builder');

const SYNC_CONFIG = {
  watch: {
    type: 'watch',
    progressFile: '/tmp/sync_progress_watch.json',
    productType: 'watch',
    collectionName: 'Watches',
    requiresShipping: true,
    hasCertificate: false,
    skuField: 'Stock',
    barcodeField: (item) => item.Stock_No || item.Stock,
    priceFields: ['Price', 'Buy_Price'],
    fieldMappings: FIELD_MAPPINGS.watch,
    titleFn: (item) => item.Name || `${item.Brand || ''} ${item.Model || ''}`.trim() || 'Watch',
    imageAltFn: (item) => `${item.Brand || ''} ${item.Model || ''}`.trim(),
    tagFields: ['Brand', 'Model', 'Reference', 'Condition', 'Case', 'Movement', 'Year'],
    inventoryFn: (item) => {
      const parsed = parseInt(String(item.Availability || '').replace(/[^0-9]/g, ''), 10);
      return (Number.isFinite(parsed) && parsed > 0) ? parsed : 1;
    },
    extraHtmlFn: (item) => item.DnaLink
      ? `<p style="margin-top:20px;color:#666"><a href="${item.DnaLink}" target="_blank">View on DNA</a></p>`
      : ''
  },

  lab: {
    type: 'lab',
    progressFile: '/tmp/sync_progress_lab.json',
    productType: 'lab-diamond',
    collectionName: 'Lab-Grown Diamonds',
    requiresShipping: false,
    hasCertificate: true,
    skuField: 'Stock_No',
    barcodeField: (item) => item.Stock_No,
    priceFields: ['Buy_Price', 'Memo_Price'],
    fieldMappings: FIELD_MAPPINGS.lab,
    titleFn: (item) => item.Shape
      ? `${item.Shape.charAt(0).toUpperCase() + item.Shape.slice(1).toLowerCase()}${item.Weight ? ' - ' + item.Weight + 'ct' : ''}`
      : (item.Name || 'Product'),
    imageAltFn: (item) => `${item.Shape || ''} ${item.Weight || ''}ct`.trim(),
    tagFields: ['Diamond_Type', 'Lab', 'Color', 'Clarity', 'Shape'],
    inventoryFn: () => 1,
    extraHtmlFn: () => ''
  },

  natural: {
    type: 'natural',
    progressFile: '/tmp/sync_progress_natural.json',
    productType: 'natural-diamond',
    collectionName: 'Natural Diamonds',
    requiresShipping: false,
    hasCertificate: true,
    skuField: 'Stock_No',
    barcodeField: (item) => item.Stock_No,
    priceFields: ['Buy_Price', 'Memo_Price'],
    fieldMappings: FIELD_MAPPINGS.natural,
    titleFn: (item) => item.Shape
      ? `${item.Shape.charAt(0).toUpperCase() + item.Shape.slice(1).toLowerCase()}${item.Weight ? ' - ' + item.Weight + 'ct' : ''}`
      : (item.Name || 'Product'),
    imageAltFn: (item) => `${item.Shape || ''} ${item.Weight || ''}ct`.trim(),
    tagFields: ['Lab', 'Color', 'Clarity', 'Shape', 'Cut_Grade'],
    inventoryFn: () => 1,
    extraHtmlFn: () => ''
  },

  jewelry: {
    type: 'jewelry',
    progressFile: '/tmp/sync_progress_jewelry.json',
    productType: 'jewelry',
    collectionName: 'Jewelry',
    requiresShipping: false,
    hasCertificate: true,
    skuField: 'item',
    barcodeField: (item) => item.item,
    priceFields: ['price', 'Buy_Price'],
    fieldMappings: FIELD_MAPPINGS.jewelry,
    titleFn: (item) => item.remarks || item.jew_type || 'Jewelry',
    imageAltFn: (item) => item.jew_type || 'Jewelry',
    tagFields: ['section', 'jew_type', 'metal_type', 'style'],
    inventoryFn: () => 1,
    extraHtmlFn: () => ''
  }
};

module.exports = { SYNC_CONFIG };
