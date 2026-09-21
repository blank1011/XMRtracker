const POOL_API = 'https://api.moneroocean.stream/miner';
const PRICE_API = 'https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=php';
const ADDRESS_PATTERN = /^(4|8)[1-9A-HJ-NP-Za-km-z]{94,105}$/;

function sendJson(response, status, payload) {
  response.status(status).setHeader('Cache-Control', 'no-store').json(payload);
}

async function handler(request, response) {
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' });
  const path = Array.isArray(request.query.path) ? request.query.path : [request.query.path];

  try {
    if (path[0] === 'price' && path[1] === 'php') {
      const upstream = await fetch(PRICE_API);
      const price = await upstream.json();
      if (!upstream.ok || !price?.monero?.php) return sendJson(response, 502, { error: 'PHP rate unavailable' });
      return sendJson(response, 200, { phpPerXmr: price.monero.php });
    }

    if (path[0] === 'history') {
      return sendJson(response, 200, []);
    }

    if (path[0] === 'miner') {
      const address = decodeURIComponent(path[1] || '');
      const endpoint = path.slice(2).map((part) => encodeURIComponent(part)).join('/');
      if (!ADDRESS_PATTERN.test(address) || !endpoint) return sendJson(response, 400, { error: 'Invalid API request' });
      const upstream = await fetch(`${POOL_API}/${encodeURIComponent(address)}/${endpoint}`);
      const body = await upstream.text();
      response.status(upstream.status).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', 'no-store').send(body);
      return;
    }

    return sendJson(response, 404, { error: 'Route not found' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 502, { error: 'Upstream service unavailable' });
  }
}

module.exports = handler;
