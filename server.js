const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const POOL_API = 'https://api.moneroocean.stream/miner';
const PRICE_API = 'https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=php';
const ADDRESS_PATTERN = /^(4|8)[1-9A-HJ-NP-Za-km-z]{94,105}$/;
const CONTENT_TYPES = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

async function readHistory() {
  try {
    return JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveSnapshot(address, stats) {
  const history = await readHistory();
  const snapshots = history[address] || [];
  snapshots.push({ timestamp: Date.now(), amtPaid: stats.amtPaid || 0, amtDue: stats.amtDue || 0, hash: stats.hash || 0, validShares: stats.validShares || 0 });
  history[address] = snapshots.slice(-288);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  response.end(JSON.stringify(payload));
}

async function proxyPool(response, address, endpoint) {
  if (!ADDRESS_PATTERN.test(address)) return sendJson(response, 400, { error: 'Invalid wallet address' });
  const upstream = await fetch(`${POOL_API}/${encodeURIComponent(address)}/${endpoint}`, { signal: AbortSignal.timeout(15000) });
  const body = await upstream.text();
  response.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  response.end(body);
  if (upstream.ok && endpoint === 'stats') {
    try { await saveSnapshot(address, JSON.parse(body)); } catch (error) { console.error('Could not save earnings snapshot:', error.message); }
  }
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(ROOT, requested);
  if (!filePath.startsWith(ROOT) || filePath === DATA_DIR || filePath.startsWith(`${DATA_DIR}${path.sep}`)) return sendJson(response, 403, { error: 'Forbidden' });
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  } catch (error) {
    sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: 'File not found' });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
    return response.end();
  }
  try {
    const apiMatch = url.pathname.match(/^\/api\/miner\/([^/]+)\/(.+)$/);
    if (apiMatch) return await proxyPool(response, decodeURIComponent(apiMatch[1]), apiMatch[2]);
    const historyMatch = url.pathname.match(/^\/api\/history\/([^/]+)$/);
    if (historyMatch) {
      const address = decodeURIComponent(historyMatch[1]);
      if (!ADDRESS_PATTERN.test(address)) return sendJson(response, 400, { error: 'Invalid wallet address' });
      const history = await readHistory();
      return sendJson(response, 200, history[address] || []);
    }
    if (url.pathname === '/api/price/php') {
      const upstream = await fetch(PRICE_API, { signal: AbortSignal.timeout(10000) });
      const price = await upstream.json();
      if (!upstream.ok || !price?.monero?.php) return sendJson(response, 502, { error: 'PHP rate unavailable' });
      return sendJson(response, 200, { phpPerXmr: price.monero.php });
    }
    return await serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 502, { error: 'Upstream service unavailable' });
  }
});

server.listen(PORT, () => console.log(`XMR dashboard running at http://localhost:${PORT}`));
