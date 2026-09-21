const PRICE_API = 'https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=php';

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const upstream = await fetch(PRICE_API);
    const price = await upstream.json();
    if (!upstream.ok || !price?.monero?.php) return response.status(502).json({ error: 'PHP rate unavailable' });
    return response.status(200).setHeader('Cache-Control', 'no-store').json({ phpPerXmr: price.monero.php });
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: 'Upstream service unavailable' });
  }
};
