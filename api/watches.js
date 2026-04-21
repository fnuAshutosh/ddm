// View Belgiumdia Watch Data - View JSON in browser
// GET endpoint that returns watch product data as JSON

const https = require('https');

const PROXY_URL = 'https://ddm-theta.vercel.app/api/proxy';

// Fetch watch data from belgiumdia proxy
async function fetchWatchData(page = 1, limit = 50) {
  try {
    const url = new URL(PROXY_URL);
    url.searchParams.append('type', 'watch');
    url.searchParams.append('page', page);
    url.searchParams.append('limit', limit);

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Proxy returned ${response.status}`);
    
    const data = await response.json();
    return data;
  } catch (e) {
    throw new Error(`Failed to fetch watch data: ${e.message}`);
  }
}

// Vercel handler
module.exports = async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version,X-Response-Time,X-Request-Id');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  try {
    // Get page and limit from query params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const data = await fetchWatchData(page, limit);
    
    res.status(200).json({
      success: true,
      type: 'watch',
      page,
      limit,
      total_items: data.total_items,
      total_pages: data.total_pages,
      items: data.items || [],
      fetched_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('Error:', e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
};