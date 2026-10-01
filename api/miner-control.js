const crypto = require('node:crypto');

const WORKER_ID_PATTERN = /^aoi\d+$/;

function sendJson(response, status, payload) {
  return response.status(status).setHeader('Cache-Control', 'no-store').json(payload);
}

function matchesSecret(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function bearerToken(request) {
  const authorization = request.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

function getAgentTokens() {
  const tokenMaps = [process.env.CONTROL_AGENT_TOKENS, process.env.CONTROL_AGENT_TOKENS_ADDITIONAL]
    .map((value) => {
      try {
        const tokens = JSON.parse(value || '{}');
        return tokens && typeof tokens === 'object' && !Array.isArray(tokens) ? tokens : {};
      } catch {
        return {};
      }
    });
  return Object.assign({}, ...tokenMaps);
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase is not configured');
  return { url, serviceKey };
}

async function supabaseRequest(path, options = {}) {
  const { url, serviceKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/worker_controls${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    console.error('Supabase control request failed:', response.status, await response.text());
    throw new Error('Control storage request failed');
  }
  return response.status === 204 ? [] : response.json();
}

async function readWorkerState(workerId) {
  const filter = new URLSearchParams({
    select: 'worker_id,state,updated_at',
    worker_id: `in.(all,${workerId})`,
    order: 'updated_at.desc',
    limit: '2'
  });
  const rows = await supabaseRequest(`?${filter.toString()}`);
  return rows[0] || { worker_id: workerId, state: 'idle', updated_at: null };
}

async function writeState(workerId, state) {
  const rows = await supabaseRequest('?on_conflict=worker_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ worker_id: workerId, state, updated_at: new Date().toISOString() })
  });
  return rows[0];
}

module.exports = async function handler(request, response) {
  if (request.method === 'GET') {
    const workerId = String(request.query.workerId || '');
    if (!WORKER_ID_PATTERN.test(workerId)) return sendJson(response, 400, { error: 'Invalid worker ID' });

    const expectedToken = getAgentTokens()[workerId];
    if (!expectedToken || !matchesSecret(bearerToken(request), expectedToken)) {
      return sendJson(response, 401, { error: 'Unauthorized agent' });
    }

    try {
      const control = await readWorkerState(workerId);
      return sendJson(response, 200, { workerId, state: control.state, updatedAt: control.updated_at });
    } catch (error) {
      console.error(error);
      return sendJson(response, 503, { error: 'Control service unavailable' });
    }
  }

  if (request.method === 'POST') {
    if (!matchesSecret(bearerToken(request), process.env.CONTROL_ADMIN_KEY)) {
      return sendJson(response, 401, { error: 'Unauthorized dashboard' });
    }

    const { action, workerId = 'all' } = request.body || {};
    if (!['pause', 'resume'].includes(action) || (workerId !== 'all' && !WORKER_ID_PATTERN.test(workerId))) {
      return sendJson(response, 400, { error: 'Invalid mining control command' });
    }

    try {
      const control = await writeState(workerId, action === 'pause' ? 'paused' : 'running');
      return sendJson(response, 200, { ok: true, workerId, state: control.state, updatedAt: control.updated_at });
    } catch (error) {
      console.error(error);
      return sendJson(response, 503, { error: 'Control service unavailable' });
    }
  }

  response.setHeader('Allow', 'GET, POST');
  return sendJson(response, 405, { error: 'Method not allowed' });
};