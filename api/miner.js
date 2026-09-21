const POOL_API = 'https://api.moneroocean.stream/miner';
const ADDRESS_PATTERN = /^(4|8)[1-9A-HJ-NP-Za-km-z]{94,105}$/;

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  const address = request.query.address;
  const endpoint = String(request.query.path || '').split('/').filter(Boolean);
  if (!ADDRESS_PATTERN.test(address || '') || endpoint.length === 0 || endpoint.some((part) => part === '..')) {
    return response.status(400).json({ error: 'Invalid API request' });
  }
  try {
    const target = `${POOL_API}/${encodeURIComponent(address)}/${endpoint.map((part) => encodeURIComponent(part)).join('/')}`;
    const upstream = await fetch(target);
    const body = await upstream.text();
    return response.status(upstream.status).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', 'no-store').send(body);
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: 'Upstream service unavailable' });
  }
};
