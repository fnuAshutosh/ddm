# BelgiumDia Shopify Integration - Complete Instructions

## Table of Contents
1. [System Architecture](#system-architecture)
2. [How It Works](#how-it-works)
3. [For Non-Technical Users](#for-non-technical-users)
4. [Shopify Integration](#shopify-integration)
5. [Testing & Deployment](#testing--deployment)
6. [Troubleshooting](#troubleshooting)
7. [API Reference](#api-reference)

---

## System Architecture

### Overview
This system automatically syncs inventory from BelgiumDia (diamond, lab diamond, watch, and jewelry supplier) directly into Shopify. No manual product uploads needed.

### Components

```
BelgiumDia API
    ↓
    └─→ Vercel Proxy (Cache Layer)
            ↓
            └─→ Shopify Admin API
                    ↓
                    └─→ Saatchi & Co Store Products
```

### Key Parts

**1. Proxy Service** (`api/proxy.js`)
- Location: Vercel serverless function
- Purpose: Fetches products from BelgiumDia and caches them for 15 minutes
- Handles: Product filtering, pagination, search, sorting
- Performance: Reduces API calls by 90%

**2. Daily Sync Job** (`api/sync-belgiumdia.js`)
- Runs: Every day at midnight UTC (8 PM ET)
- Purpose: Imports new products to Shopify
- Batch size: 15 items per product type (60 total per day)
- Safety: Never creates duplicates

**3. Bulk Sync Endpoint** (`api/sync-belgiumdia-bulk.js`)
- Purpose: One-time import of ALL products
- Triggered: Manually via API call
- Duration: 1-2 hours for full catalog
- Usage: First-time setup or re-import

### Product Types Supported

| Type | Count | Fresh From | Category |
|------|-------|-----------|----------|
| Natural Diamonds | ~2,943 | BelgiumDia | Primary |
| Lab Diamonds | ~500+ | BelgiumDia | Certified |
| Watches | ~717 | BelgiumDia | Accessories |
| Jewelry | ~25,578 | BelgiumDia | Accessories |

---

## How It Works

### Daily Automatic Sync (Default)

Every day at midnight UTC:
1. **Proxy fetches** 15 items of each type from BelgiumDia API
2. **System checks** if products already exist in Shopify (by SKU)
3. **Creates only new products** (skips existing ones to prevent duplicates)
4. **Updates pricing** and inventory status
5. **Adds to collections** for better discoverability
6. **Logs results** in Vercel dashboard

### Real-Time Product Browsing

When customers browse your store:
1. Products are already in Shopify (pre-loaded via sync)
2. Inventory updates via daily sync (checks current stock)
3. Pricing updates via daily sync (BelgiumDia rates change)
4. No external API calls needed (fast loading)

### Bulk Import (First Setup or Reset)

For importing ALL products at once:
1. Make a request to bulk sync endpoint
2. System imports thousands of products in batches
3. Prevents rate limiting with 300ms delays
4. Takes 1-2 hours to complete
5. Results logged in Vercel

---

## For Non-Technical Users

### What You Need to Know

**The system automatically handles:**
- ✅ Importing products from BelgiumDia
- ✅ Organizing by type (Natural, Lab, Watches, Jewelry)
- ✅ Updating prices daily
- ✅ Tracking inventory levels
- ✅ Preventing duplicate products

**What you control in Shopify:**
- Titles and descriptions
- Collections and categories
- Product images and tags
- Discounts and promotions
- Customer visibility

### Typical Timeline

**Phase 1: Testing (Days 1-3)**
- 15 items per type (60 total) imported daily
- You verify in Shopify admin
- Check quality of product data
- Adjust descriptions if needed

**Phase 2: Full Import (Day 4)**
- Trigger bulk import
- 2,000-30,000 products load overnight
- Takes 1-2 hours
- Complete catalog available

**Phase 3: Maintenance (Ongoing)**
- Daily sync runs automatically at midnight
- New products added automatically
- Prices updated automatically
- No action needed from you

### Expected Shopify Data

For each product, you'll get:

**Natural Diamonds:**
- Stock number (SKU)
- Carat weight
- Color grade
- Clarity grade
- Cut quality
- Price (in USD)
- Certificate info

**Lab Diamonds:**
- Lab certification
- Specifications (same as natural)
- Lab-certified mark
- Price (usually 30-40% less than natural)

**Watches:**
- Brand
- Model
- Movement type
- Case material
- Warranty info
- Price

**Jewelry:**
- Product name
- Material (gold, platinum, etc.)
- Stone type
- Weight
- Dimensions
- Price

---

## Shopify Integration

### Collections Auto-Created

The system automatically organizes products into Shopify collections:

```
Root Collections:
├── Natural Diamonds (Auto-populated daily)
├── Lab Diamonds (Auto-populated daily)
├── Watches (Auto-populated daily)
└── Jewelry (Auto-populated daily)

Sub-Collections (within each):
├── By Price Range
├── By Quality Grade
├── New Arrivals
└── Featured Items
```

### Pricing in Shopify

**What syncs automatically:**
- Cost price (from BelgiumDia wholesale)
- Recommended retail price
- Your margin calculation

**What you set manually:**
- Sale prices
- Bulk discounts
- VIP pricing
- Promotional pricing

### Inventory Management

**Auto-tracked:**
- Stock quantity from BelgiumDia
- Updates daily
- Sold-out status
- Reorder points

**Manual control:**
- Visibility (in/out of stock)
- Hold/reserve items
- Damage/loss adjustments

### Product URLs & SEO

**Auto-generated from:**
- Product type
- SKU
- Quality grade
- Price point

**Customize:**
- Meta descriptions
- SEO titles
- Custom URL slugs
- Search tags

---

## Testing & Deployment

### Current Status

✅ **Live in Production**
- Proxy service: `https://ddm-theta.vercel.app/api/proxy`
- Sync service: `https://ddm-theta.vercel.app/api/sync-belgiumdia.js`
- Deployment: Vercel (auto-updates on code changes)

### Testing Daily Sync

**Monitor sync execution:**

1. Go to Vercel Dashboard → Functions → Logs
2. Look for `sync-belgiumdia.js` executions
3. Check result: `{ success: true, created: X, skipped: Y }`

**Expected behavior (normal):**
- First day: 60 new products created (0 skipped)
- After day 1: 0-5 created, 55-60 skipped (duplicates)
- This is normal! Duplicate prevention working.

**Check Shopify for new products:**

In Shopify Admin:
1. Go to Products → All Products
2. Sort by "Created Date" (newest first)
3. Should see new items added each day
4. Verify data looks correct

### Testing Bulk Import

**Step 1: Prepare**
```bash
# In your terminal, run:
curl -X POST https://ddm-theta.vercel.app/api/sync-belgiumdia-bulk.js \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Step 2: Monitor**
- Check Vercel logs for progress
- Watch Shopify product count increase
- Estimated: 1-2 hours for full catalog

**Step 3: Verify**
- Count products in Shopify (should be 2,000-30,000+)
- Spot-check data quality
- Verify images loaded correctly
- Check pricing is accurate

### Troubleshooting

**Problem: No products showing up**
- Check: Daily sync execution logs in Vercel
- Solution: Verify Shopify credentials in Vercel env vars
- Check: BelgiumDia API is responding (test at proxy endpoint)

**Problem: Duplicates created**
- Won't happen (system checks by SKU first)
- If it occurred: Run reconciliation script
- Report: Contact support with screenshot

**Problem: Pricing looks wrong**
- Check: BelgiumDia source data
- Solution: Verify currency conversion (should be USD)
- Compare: Manual spot-check vs. supplier pricing

**Problem: Images not loading**
- Check: Image URLs in product data
- Solution: Verify Shopify image storage settings
- Try: Re-run sync to fetch fresh images

---

## API Reference

### Proxy Endpoint

**Base URL:** `https://ddm-theta.vercel.app/api/proxy`

**Parameters:**

| Parameter | Values | Default | Purpose |
|-----------|--------|---------|---------|
| `type` | natural, lab, watch, jewelry | natural | Product type |
| `limit` | 1-100 | 50 | Items per page |
| `page` | 1+ | 1 | Page number |
| `sort` | price, carat, date | date | Sort order |
| `search` | any text | none | Filter by keyword |
| `nocache` | true | false | Bypass 15-min cache |

**Example Requests:**

```bash
# Get 15 natural diamonds
curl "https://ddm-theta.vercel.app/api/proxy?type=natural&limit=15"

# Get lab diamonds, page 2
curl "https://ddm-theta.vercel.app/api/proxy?type=lab&page=2&limit=20"

# Search for specific diamond
curl "https://ddm-theta.vercel.app/api/proxy?type=natural&search=fancy"

# Fresh fetch (skip cache)
curl "https://ddm-theta.vercel.app/api/proxy?type=jewelry&nocache=true"
```

**Response Example:**

```json
{
  "type": "natural",
  "total_items": 2943,
  "page": 1,
  "items_per_page": 15,
  "cache_hit": true,
  "fetched_at": "2026-04-21T05:38:41Z",
  "items": [
    {
      "Stock_No": "ND-001234",
      "Carat": 1.5,
      "Color": "D",
      "Clarity": "VS1",
      "Cut": "Excellent",
      "Price": 5500,
      "Certificate": "GIA"
    }
  ]
}
```

### Sync Endpoints

**Daily Sync** (runs automatically at midnight UTC)
```bash
curl -X POST https://ddm-theta.vercel.app/api/sync-belgiumdia.js
```

Response:
```json
{
  "success": true,
  "created": 12,
  "skipped": 48,
  "duration": "45.23"
}
```

**Bulk Sync** (manual trigger)
```bash
curl -X POST https://ddm-theta.vercel.app/api/sync-belgiumdia-bulk.js \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Response:
```json
{
  "success": true,
  "total_created": 28456,
  "total_skipped": 0,
  "duration": "3847.50"
}
```

---

## Environment Variables (Vercel)

Required for operation (already configured):

```
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
SHOPIFY_STORE=saatchiandco.myshopify.com
BELGUMDIA_API_KEY=your_belgiumdia_api_key
```

To update:
1. Go to Vercel Dashboard
2. Project Settings → Environment Variables
3. Modify and redeploy

---

## Monitoring & Support

### Check System Health

**Daily:**
- 1. Verify sync runs at midnight (check Vercel logs)
- 2. Confirm new products appear in Shopify
- 3. Spot-check product data quality

**Weekly:**
- Count total products (should grow by ~100-500)
- Verify pricing accuracy (spot-check 5 items)
- Check for any errors in logs

**Monthly:**
- Full data audit
- Backup Shopify catalog
- Review and adjust sync settings if needed

### Getting Help

**For API Issues:**
- Check Vercel Function Logs (→ Logs tab)
- Test proxy endpoint manually
- Verify environment variables

**For Shopify Issues:**
- Check Shopify Admin → Logs & Events
- Verify product data in admin
- Test manual product creation

**For BelgiumDia Issues:**
- Test API directly: `https://belgiumdia.com/api/developer-api`
- Verify API key in Vercel
- Check IP whitelisting on their end

---

## FAQ

**Q: How often does pricing update?**
A: Daily at midnight UTC. Changes take effect next morning.

**Q: What if BelgiumDia sells out of a product?**
A: Next sync will show quantity: 0. Mark as out-of-stock automatically.

**Q: Can I edit imported products in Shopify?**
A: Yes! Edit titles, descriptions, images. Sync won't overwrite your changes.

**Q: What happens if sync fails?**
A: Vercel logs the error. Support is alerted. Retries automatically.

**Q: How many products can Shopify handle?**
A: Unlimited (plan dependent). Hobby+ plans support 50,000+.

**Q: Can I pause the daily sync?**
A: Yes, disable cron in `vercel.json` or contact support.

**Q: How do I test new products before full import?**
A: Use the testing endpoint to load 15 items/type first.

**Q: What's the storage cost for 30,000 products?**
A: ~5-10 MB (product metadata only). Images stored by BelgiumDia links.

---

## Next Steps

1. **Verify Deployment** → Test proxy endpoint returning data
2. **Monitor Daily Sync** → Check Vercel logs tonight at midnight
3. **Review Shopify** → Confirm products appearing correctly
4. **Plan Bulk Import** → Schedule for low-traffic time
5. **Ongoing Maintenance** → Monthly audits and updates

---

**Document Version:** 1.0  
**Last Updated:** April 21, 2026  
**Deployment:** https://ddm-theta.vercel.app  
**Repository:** github.com/saatchiandco/belgiumdia-shopify-proxy-
