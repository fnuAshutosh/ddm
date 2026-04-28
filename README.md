# Belgumdia Diamond Proxy

Secure Vercel proxy between saatchiandco.com (Shopify) and the BelgiumDia supplier API.

## What this solves

BelgiumDia returns ~5.3MB per API call. Shopify Flow's HTTP action has a hard 1MB limit.
This proxy runs server-side on Vercel (free tier), fetches the full response, caches it
for 15 minutes, and returns paginated slices (~50KB) to the Shopify storefront.

The API key is stored as a Vercel environment variable and **never exposed to the browser**.

---

## Deployment — Vercel (15 minutes)

### 1. Create a Vercel account
Go to https://vercel.com and sign up (free).

### 2. Deploy this project

**Option A — GitHub (recommended)**
1. Push this folder to a GitHub repo
2. In Vercel dashboard → "Add New Project" → import the repo
3. Framework: **Other**
4. Click Deploy

**Option B — Vercel CLI**
```bash
npm i -g vercel
cd belgumdia-proxy
vercel
```

### 3. Set the environment variable
In Vercel dashboard → your project → **Settings → Environment Variables**:

| Name | Value |
|------|-------|
| `BELGUMDIA_API_KEY` | `your-actual-api-key-here` |

Then redeploy: **Deployments → ⋯ → Redeploy**

### 4. Note your deployment URL
It will look like: `https://belgumdia-proxy-xxxx.vercel.app`

---

## Shopify Setup

### 1. Add the section file
Copy `theme/sections/belgumdia.liquid` into your Shopify theme's `sections/` folder
via the Theme Editor code view or Theme Kit.

### 2. Create a page
- Shopify Admin → **Online Store → Pages → Add page**
- Title: `Belgumdia Collection` (or whatever you like)
- Template: `page` (default is fine)
- Save

### 3. Add the section to the page
- Open the **Theme Editor** (Customize)
- Navigate to the page you just created
- Click **Add section** → find "Belgumdia Inventory"
- In the section settings, paste your Vercel URL:
  `https://belgumdia-proxy-xxxx.vercel.app`
- Optionally adjust "Items per page"
- **Save**

---

## API Reference

### All API URLs

Replace `<YOUR_VERCEL_URL>` with your deployment URL (for example, `https://ddm-theta.vercel.app`).

#### Proxy endpoints

- `GET <YOUR_VERCEL_URL>/api/proxy?type=natural`
- `GET <YOUR_VERCEL_URL>/api/proxy?type=lab`
- `GET <YOUR_VERCEL_URL>/api/proxy?type=watch`
- `GET <YOUR_VERCEL_URL>/api/proxy?type=jewelry`
- `GET <YOUR_VERCEL_URL>/api/proxy?type=natural&page=1&limit=50&search=round&sort=price_asc`
- `GET <YOUR_VERCEL_URL>/api/proxy?action=cache`
- `GET <YOUR_VERCEL_URL>/api/proxy?action=cache&key=natural_page1&includeItems=true&itemsLimit=100`
- `GET <YOUR_VERCEL_URL>/api/proxy?action=warm`
- `GET <YOUR_VERCEL_URL>/api/proxy?action=warm&mode=all&types=natural,lab,watch,jewelry`

#### Sync endpoints (create Shopify products from belgiumdia items)

- `GET <YOUR_VERCEL_URL>/api/sync-natural?max_create=50` — Sync natural diamonds
- `GET <YOUR_VERCEL_URL>/api/sync-lab?max_create=50` — Sync lab diamonds
- `GET <YOUR_VERCEL_URL>/api/sync-watch?max_create=50` — Sync watches
- `GET <YOUR_VERCEL_URL>/api/sync-jewelry?max_create=50` — Sync jewelry

Each sync endpoint:
- Fetches items from belgiumdia proxy
- Creates Shopify products with 3 images, videos, and characteristics table
- Tracks inventory in Shopify
- Publishes products to Online Store
- Maintains progress file so syncs can resume

### `GET /api/proxy`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | ✅ | `natural`, `lab`, `watch`, or `jewelry` |
| `page` | number | | Page number (default: 1) |
| `limit` | number | | Items per page (default: 50, max: 100) |
| `search` | string | | Text search across all fields |
| `sort` | string | | `price_asc`, `price_desc`, `carat_asc`, `carat_desc` |

**Example:**
```
GET https://belgumdia-proxy.vercel.app/api/proxy?type=natural&page=2&limit=48&sort=price_asc
```

**Response:**
```json
{
  "type": "natural",
  "page": 2,
  "limit": 48,
  "total_items": 2943,
  "total_pages": 62,
  "fetched_at": "2024-01-15T10:30:00.000Z",
  "cache_hit": true,
  "items": [ ... ]
}
```

---

## Caching behaviour

| Situation | Behaviour |
|-----------|-----------|
| First request for a type | Fetches from BelgiumDia (~2–4s), caches in memory |
| Subsequent requests within 15 min | Returns from cache instantly |
| After 15 minutes | Re-fetches from BelgiumDia |
| Vercel instance recycles | Cache clears, next request re-fetches |

Vercel's free tier keeps instances warm for ~10 minutes of inactivity.
For a production store, consider upgrading to Vercel Pro ($20/mo) for guaranteed warm instances,
or add a simple cron ping (e.g. UptimeRobot free tier pinging `/api/proxy?type=natural` every 5 min).

---

## CORS

Requests are allowed from:
- `https://saatchiandco.com`
- `*.myshopify.com` (for theme editor preview)
- `localhost:3000` (for local dev)

To add more origins, edit the `corsHeaders()` function in `api/proxy.js`.

---

## Troubleshooting

**"BELGUMDIA_API_KEY env var not set"**
→ You haven't added the env var in Vercel. See step 3 above.

**Cards show but all prices say "POA"**
→ The API uses a different field name for price. Open browser DevTools → Network → click
a proxy request → check `items[0]` in the response to find the correct field name,
then update `renderCard()` in `belgumdia.liquid`.

**502 error on first load**
→ The supplier API might be slow or rate-limited. Wait 15 minutes and try again.

**Section doesn't appear in Theme Editor**
→ Make sure the file is saved as `sections/belgumdia.liquid` (not in a subfolder).

---

## File structure

```
belgiumdia-shopify-sync/
├── api/                          ← Vercel serverless functions
│   ├── proxy.js                  ← Proxy: fetch & cache belgiumdia data
│   ├── product-builder.js        ← Shared utilities: HTML tables, video upload
│   ├── sync-natural.js           ← Sync natural diamonds to Shopify
│   ├── sync-lab.js               ← Sync lab diamonds to Shopify
│   ├── sync-watch.js             ← Sync watches to Shopify
│   └── sync-jewelry.js           ← Sync jewelry to Shopify
├── tests/                        ← Test scripts (not deployed)
│   ├── test-create-product.js    ← Test watch product creation
│   ├── test-lab.js               ← Test lab diamond creation
│   ├── test-jewelry.js           ← Test jewelry creation
│   ├── test-natural.js           ← Test natural diamond creation
│   └── test-watch.sh             ← Shell test for watch
├── vercel.json                   ← Vercel config
├── README.md
└── product_template.csv          ← Template for bulk imports
```
