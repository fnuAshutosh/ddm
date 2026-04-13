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

// In-memory cache (persists across warm invocations on same instance)
const cache = {};

function buildSupplierUrl(type) {
  const key = process.env.BELGUMDIA_API_KEY;
  if (!key) throw new Error("BELGUMDIA_API_KEY env var not set");

  const base = "https://belgiumdia.com/api/developer-api";

  if (type === "natural") return `${base}/diamond?type=natural&key=${key}`;
  if (type === "lab")     return `${base}/diamond?type=lab&key=${key}`;
  if (type === "watch")   return `${base}/watch?key=${key}`;
  if (type === "jewelry") return `${base}/jewelry?key=${key}`;

  throw new Error(`Unknown type: ${type}`);
}

async function fetchWithCache(type) {
  const now = Date.now();
  const cached = cache[type];

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { items: cached.items, fromCache: true, fetchedAt: cached.fetchedAt };
  }

  const url = buildSupplierUrl(type);
  const res = await fetch(url, { headers: { Accept: "application/json" } });

  if (!res.ok) {
    throw new Error(`Supplier API returned ${res.status} for type=${type}`);
  }

  const json = await res.json();

  // Normalise: supplier wraps data in different keys per endpoint
  let items = [];
  if (Array.isArray(json))              items = json;
  else if (Array.isArray(json.data))    items = json.data;
  else if (Array.isArray(json.diamond)) items = json.diamond;
  else if (Array.isArray(json.watch))   items = json.watch;
  else if (Array.isArray(json.jewelry)) items = json.jewelry;
  else {
    // Last resort: find the first array value in the response object
    const firstArray = Object.values(json).find(Array.isArray);
    items = firstArray || [];
  }

  cache[type] = { items, fetchedAt: now };
  return { items, fromCache: false, fetchedAt: now };
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

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(204).set(headers).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type, page, limit, search, sort } = req.query;

  // Validate type
  const validTypes = ["natural", "lab", "watch", "jewelry"];
  if (!type || !validTypes.includes(type)) {
    return res.status(400).set(headers).json({
      error: `type must be one of: ${validTypes.join(", ")}`,
    });
  }

  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(limit, 10) || PAGE_SIZE_DEFAULT));

  try {
    const { items, fromCache, fetchedAt } = await fetchWithCache(type);

    // Apply search + sort
    const filtered = applySort(applySearch(items, search), sort);

    // Paginate
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const start = (pageNum - 1) * pageSize;
    const slice = filtered.slice(start, start + pageSize);

    res.set({
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=60",
      "X-Cache": fromCache ? "HIT" : "MISS",
      "X-Fetched-At": new Date(fetchedAt).toISOString(),
    });

    return res.status(200).json({
      type,
      page: pageNum,
      limit: pageSize,
      total_items: totalItems,
      total_pages: totalPages,
      fetched_at: new Date(fetchedAt).toISOString(),
      cache_hit: fromCache,
      items: slice,
    });

  } catch (err) {
    console.error("[belgumdia-proxy] error:", err.message);
    return res.status(502).set(headers).json({
      error: "Failed to fetch from supplier",
      detail: err.message,
    });
  }
}
