const handler = require('./api/test-create-product.js');

const req = { method: 'GET', query: { mock: '1', dry: '1' } };

const res = {
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(code) { this.statusCode = code; return this; },
  json(obj) { console.log('---JSON RESPONSE---'); console.log(JSON.stringify(obj, null, 2)); },
  end() { console.log('---END---'); }
};

handler(req, res).catch(e => { console.error('HANDLER ERROR:', e); process.exit(1); });
