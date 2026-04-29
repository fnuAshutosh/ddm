// Natural Diamond Sync - Thin Vercel handler delegating to sync-core

const { syncProducts } = require('./sync-core');
const { SYNC_CONFIG } = require('./sync-config');

module.exports = async (req, res) => {
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Sync-Run-Id', runId);

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const maxCreateInput = req.query.max_create ?? req.headers['x-max-create'];
    const result = await syncProducts('natural', runId, { maxCreateInput }, SYNC_CONFIG.natural);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ success: false, run_id: runId, error: e.message });
  }
};
