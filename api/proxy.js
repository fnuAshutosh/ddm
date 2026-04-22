/**
 * Belgumdia Diamond Proxy
 * Deployed on Vercel — keeps API key secret, slices large responses,
 * caches per endpoint for 15 min to respect supplier rate limits.
 *
 * Query params:
 *   type    = natural | lab | watch | jewelry  (required)
 *   page    = 1-based page number              (default: 1)
 *   limit   = items per page                   (default: 50, max: 100)
 *   search  = text search across shape/cut/etc (optional)
 *   sort    = price_asc | price_desc | carat_asc | carat_desc (optional)
 */

const ALLOWED_ORIGIN = "https://saatchiandco.com";
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const WARM_GUARD_MAX_PAGES = 300;
const VALID_TYPES = ["natural", "lab", "watch", "jewelry"];

// In-memory cache (persists across warm invocations on same instance)
const cache = {};

function parseCacheKey(cacheKey) {
  const match = cacheKey.match(/^(natural|lab|watch|jewelry)_page(\d+)$/);
  if (!match) return null;
  return { type: match[1], page: Number(match[2]) };
}

function getCacheSummary() {
  const now = Date.now();
  const entries = Object.entries(cache)
    .map(([key, value]) => {
      const parsed = parseCacheKey(key);
      if (!parsed) return null;

      return {
        key,
        type: parsed.type,
        page: parsed.page,
        item_count: Array.isArray(value.items) ? value.items.length : 0,
        fetched_at: new Date(value.fetchedAt).toISOString(),
        age_seconds: Math.floor((now - value.fetchedAt) / 1000),
        fresh: now - value.fetchedAt < CACHE_TTL_MS,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.page - b.page;
    });

  const grouped = VALID_TYPES.reduce((acc, type) => {
    const typeEntries = entries.filter((entry) => entry.type === type);
    acc[type] = {
      pages: typeEntries.length,
      items: typeEntries.reduce((sum, entry) => sum + entry.item_count, 0),
    };
    return acc;
  }, {});

  return { entries, grouped };
}

async function warmCache({ types, mode, skipCache }) {
  const normalizedTypes = (types || VALID_TYPES).filter((type) => VALID_TYPES.includes(type));
  const warmAllPages = mode === "all";
  const summary = {
    warmed_types: normalizedTypes,
    warmed_pages: 0,
    warmed_items: 0,
    stopped_early: false,
    type_results: {},
  };

  for (const type of normalizedTypes) {
    let page = 1;
    let pageCount = 0;
    let itemCount = 0;
    let error = null;

    while (page <= WARM_GUARD_MAX_PAGES) {
      try {
        const { items } = await fetchWithCache(type, page, skipCache);
        pageCount += 1;
        summary.warmed_pages += 1;
        itemCount += items.length;
        summary.warmed_items += items.length;

        if (!warmAllPages || items.length === 0) {
          break;
        }

        page += 1;
      } catch (err) {
        error = err.message;
        break;
      }
    }

    if (page > WARM_GUARD_MAX_PAGES) {
      summary.stopped_early = true;
    }

    summary.type_results[type] = {
      pages_warmed: pageCount,
      items_warmed: itemCount,
      error,
    };
  }

  return summary;
}

function parseSupplierItems(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];

  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.diamond)) return json.diamond;
  if (Array.isArray(json.watch)) return json.watch;
  if (Array.isArray(json.jewelry)) return json.jewelry;

  const firstArray = Object.values(json).find(Array.isArray);
  return firstArray || [];
}

function buildSupplierUrl(type, page = 1) {
  const key = process.env.BELGUMDIA_API_KEY;
  if (!key) throw new Error("BELGUMDIA_API_KEY env var not set");

  const base = "https://belgiumdia.com/api/developer-api";

  if (type === "natural") return `${base}/diamond?type=natural&page=${page}&key=${key}`;
  if (type === "lab")     return `${base}/diamond?type=lab&page=${page}&key=${key}`;
  if (type === "watch")   return `${base}/watch?page=${page}&key=${key}`;
  if (type === "jewelry") return `${base}/jewelry?page=${page}&key=${key}`;

  throw new Error(`Unknown type: ${type}`);
}

async function fetchWithCache(type, page = 1, skipCache = false) {
  const now = Date.now();
  const cacheKey = `${type}_page${page}`;
  const cached = cache[cacheKey];

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS && !skipCache) {
    console.log(`[belgumdia-proxy] Cache HIT for ${cacheKey}`);
    return { items: cached.items, fromCache: true, fetchedAt: cached.fetchedAt };
  }

  const url = buildSupplierUrl(type, page);
  console.log(`[belgumdia-proxy] Fetching from: ${url.replace(/key=.+/, 'key=***')}`);
  
  let timeoutId;

  try {
    // Fetch with 30 second timeout
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const res = await fetch(url, { 
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[belgumdia-proxy] API error ${res.status}: ${errorText.substring(0, 200)}`);
      throw new Error(`Supplier API returned ${res.status}`);
    }

    const json = await res.json();
    console.log(`[belgumdia-proxy] API response keys:`, Object.keys(json));
    
    const items = parseSupplierItems(json);

    // Treat supplier-level failures as hard errors so callers can distinguish
    // empty inventory from upstream API errors.
    if (json && typeof json === "object") {
      const supplierMessage = typeof json.message === "string" ? json.message : "";
      const explicitError = typeof json.error === "string" ? json.error : "";
      const hasSupplierError = (supplierMessage && supplierMessage !== "Success") || explicitError;

      if (hasSupplierError && items.length === 0) {
        throw new Error(`Supplier message: ${explicitError || supplierMessage}`);
      }
    }

    console.log(`[belgumdia-proxy] Found ${items.length} items for ${type}`);
    cache[cacheKey] = { items, fetchedAt: now };
    return { items, fromCache: false, fetchedAt: now };
    
  } catch (err) {
    console.error(`[belgumdia-proxy] Fetch error for ${type}:`, err.message);
    if (cached && !skipCache) {
      console.warn(`[belgumdia-proxy] Serving stale cache for ${cacheKey} after fetch failure`);
      return { items: cached.items, fromCache: true, fetchedAt: cached.fetchedAt, stale: true };
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function applySearch(items, search) {
  if (!search) return items;
  const q = search.toLowerCase();
  return items.filter((item) => {
    return Object.values(item).some(
      (v) => typeof v === "string" && v.toLowerCase().includes(q)
    );
  });
}

function applySort(items, sort) {
  if (!sort) return items;
  const sorted = [...items];
  switch (sort) {
    case "price_asc":
      return sorted.sort((a, b) => parseFloat(a.price || a.Price || 0) - parseFloat(b.price || b.Price || 0));
    case "price_desc":
      return sorted.sort((a, b) => parseFloat(b.price || b.Price || 0) - parseFloat(a.price || a.Price || 0));
    case "carat_asc":
      return sorted.sort((a, b) => parseFloat(a.carat || a.Carat || 0) - parseFloat(b.carat || b.Carat || 0));
    case "carat_desc":
      return sorted.sort((a, b) => parseFloat(b.carat || b.Carat || 0) - parseFloat(a.carat || a.Carat || 0));
    default:
      return sorted;
  }
}

function corsHeaders(origin) {
  // Allow saatchiandco.com in production; also allow localhost for dev
  const allowed = [ALLOWED_ORIGIN, "http://localhost:3000", "http://127.0.0.1"];
  const isAllowed = allowed.includes(origin) || (origin && origin.endsWith(".myshopify.com"));

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function setHeaders(res, headers) {
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    setHeaders(res, headers);
    return res.writeHead(204).end();
  }

  if (req.method !== "GET") {
    setHeaders(res, headers);
    res.writeHead(405);
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  const { action, type, page, limit, search, sort } = req.query;

  if (action === "cache") {
    const { entries, grouped } = getCacheSummary();
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const includeItems = req.query.includeItems === "true";
    const itemsLimit = Math.max(1, Math.min(500, parseInt(req.query.itemsLimit, 10) || 100));

    const response = {
      entries,
      grouped,
      total_entries: entries.length,
      ttl_seconds: Math.floor(CACHE_TTL_MS / 1000),
    };

    if (includeItems && key) {
      const selected = cache[key];
      if (!selected) {
        setHeaders(res, { ...headers, "Content-Type": "application/json" });
        res.writeHead(404);
        return res.end(JSON.stringify({ error: `cache key not found: ${key}`, ...response }));
      }

      response.selected = {
        key,
        item_count: Array.isArray(selected.items) ? selected.items.length : 0,
        fetched_at: new Date(selected.fetchedAt).toISOString(),
        items: (selected.items || []).slice(0, itemsLimit),
      };
    }

    setHeaders(res, { ...headers, "Content-Type": "application/json" });
    res.writeHead(200);
    return res.end(JSON.stringify(response));
  }

  if (action === "warm") {
    const mode = req.query.mode === "all" ? "all" : "first-page";
    const skipCache = req.query.nocache === "true";
    const types = typeof req.query.types === "string"
      ? req.query.types.split(",").map((s) => s.trim()).filter(Boolean)
      : VALID_TYPES;

    try {
      const warmResult = await warmCache({ types, mode, skipCache });
      const snapshot = getCacheSummary();
      setHeaders(res, { ...headers, "Content-Type": "application/json" });
      res.writeHead(200);
      return res.end(JSON.stringify({
        action: "warm",
        mode,
        ...warmResult,
        cache_after: snapshot,
      }));
    } catch (err) {
      setHeaders(res, { ...headers, "Content-Type": "application/json" });
      res.writeHead(500);
      return res.end(JSON.stringify({ error: "cache warm failed", detail: err.message }));
    }
  }

  // Add skipCache if ?nocache=true is passed
  const skipCache = req.query.nocache === 'true';

  // Validate type
  if (!type || !VALID_TYPES.includes(type)) {
    setHeaders(res, headers);
    res.writeHead(400);
    return res.end(JSON.stringify({
      error: `type must be one of: ${VALID_TYPES.join(", ")}`,
    }));
  }

  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(limit, 10) || PAGE_SIZE_DEFAULT));

  try {
    const { items, fromCache, fetchedAt, stale } = await fetchWithCache(type, pageNum, skipCache);

    // Apply search + sort
    const filtered = applySort(applySearch(items, search), sort);

    // Paginate
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const start = (pageNum - 1) * pageSize;
    const slice = filtered.slice(start, start + pageSize);

    const responseHeaders = {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=60",
      "X-Cache": fromCache ? "HIT" : "MISS",
      "X-Fetched-At": new Date(fetchedAt).toISOString(),
        "X-Stale": stale ? "1" : "0",
    };
    setHeaders(res, responseHeaders);

    const responseBody = {
      type,
      page: pageNum,
      limit: pageSize,
      total_items: totalItems,
      total_pages: totalPages,
      fetched_at: new Date(fetchedAt).toISOString(),
      cache_hit: fromCache,
        stale: Boolean(stale),
      items: slice,
    };

    res.writeHead(200);
    return res.end(JSON.stringify(responseBody));

  } catch (err) {
    console.error("[belgumdia-proxy] error:", err.message);
    setHeaders(res, headers);
    res.writeHead(502);
    return res.end(JSON.stringify({
      error: "Failed to fetch from supplier",
      detail: err.message,
    }));
  }
};