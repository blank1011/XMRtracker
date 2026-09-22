const STORAGE_KEY = 'xmr-miner-dashboard-v1';
const MINER_PAGE_SIZE = 15;
const MONEROOCEAN_API = 'https://api.moneroocean.stream/miner';
const API_BASE = window.location.protocol === 'file:' ? MONEROOCEAN_API : '/api/miner';
const PRICE_API = window.location.protocol === 'file:' ? 'https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=php' : '/api/price/php';
const ATOMIC_UNITS_PER_XMR = 1e12;
const DEFAULT_WALLET_ADDRESS = '45Y799bJYW4KSZfB5nxPFEdFYhiekGtgJDdeUq5NM5JULam78abKGbhB6chJ1hGFMXfRqyuVxA8pfaG1oeT6oAw3TgojuZH';
const STALE_AFTER_MS = 10 * 60 * 1000;
const rigDirectory = [
  ['PC15', '1551255560'],
  ['PC14', '1825189192'],
  ['PC13', '1178337593'],
  ['PC12', '1305526658'],
  ['PC11', '1331686494'],
  ['PC10', '299006298'],
  ['PC9', '1452865932'],
  ['PC8', '1053112484'],
  ['PC27', '1648705709'],
  ['PC26', '1935666559'],
  ['PC25', '1088069133'],
  ['PC24', '1692863900'],
  ['PC16', '1960500811'],
  ['PC17', '1616217465'],
  ['PC18', '1115457674']
];

const defaultState = {
  walletAddress: DEFAULT_WALLET_ADDRESS,
  snapshots: [],
  miners: rigDirectory.map(([name, anydesk], index) => ({
    id: index + 1,
    name,
    workerId: name,
    anydesk,
    online: false,
    totalSeconds: 0,
    onlineSince: null
  })),
  logs: []
};

let state = loadState();

const minerGrid = document.querySelector('#miner-grid');
const minerBrowser = document.querySelector('.miner-browser');
const minerSlider = document.querySelector('#miner-slider');
const minerWindow = document.querySelector('#miner-window');
const activityLog = document.querySelector('#activity-log');
const onlineCount = document.querySelector('#online-count');
const offlineCount = document.querySelector('#offline-count');
const fleetHashrate = document.querySelector('#fleet-hashrate');
const onlineTrack = document.querySelector('#online-track');
const lastUpdated = document.querySelector('#last-updated');
const walletAddressInput = document.querySelector('#wallet-address');
const apiStatus = document.querySelector('#api-status');
const apiMessage = document.querySelector('#api-message');
let earningsRequest = null;
let workerData = new Map();
let lastSuccessfulSync = null;
let phpPerXmr = null;
let minerWindowStart = 0;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved?.miners)) {
      saved.miners = saved.miners.map((miner, index) => ({
        ...miner,
        id: Number.isInteger(miner.id) ? miner.id : index + 1,
        workerId: miner.workerId || rigDirectory[index]?.[0] || `worker-${index + 1}`,
        anydesk: miner.anydesk || rigDirectory[index]?.[1] || '',
        name: miner.name && !/^Miner \d+$/.test(miner.name)
          ? miner.name
          : rigDirectory[index]?.[0] || miner.workerId || `Worker ${index + 1}`
      }));
      saved.walletAddress = saved.walletAddress || DEFAULT_WALLET_ADDRESS;
      saved.snapshots = Array.isArray(saved.snapshots) ? saved.snapshots : [];
      saved.logs = Array.isArray(saved.logs) ? saved.logs : [];
      return saved;
    }
  } catch (error) {
    console.warn('Could not load saved miner data.', error);
  }
  return structuredClone(defaultState);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatDuration(seconds) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

function formatClock(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatXmr(atomicUnits) {
  return `${(Number(atomicUnits || 0) / ATOMIC_UNITS_PER_XMR).toFixed(6)} XMR`;
}

function formatHashrate(hashrate) {
  const value = Number(hashrate || 0);
  if (!value) return '--';
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} MH/s`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)} kH/s`;
  return `${Math.round(value)} H/s`;
}

function formatCompactHashrate(hashrate) {
  const value = Number(hashrate || 0);
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kH/s` : `${Math.round(value)} H/s`;
}

function isWorkerOnline(worker) {
  return worker && worker.history.length > 0 && Date.now() - worker.history[0].ts < 15 * 60 * 1000;
}

function formatWorkerDuration(worker) {
  if (!isWorkerOnline(worker)) return 'OFFLINE';
  const history = worker.history.slice().reverse();
  let start = history[0].ts;
  for (let index = 1; index < history.length; index += 1) {
    if (history[index].ts - history[index - 1].ts > 15 * 60 * 1000) start = history[index].ts;
  }
  return `ONLINE FOR ${formatDuration(Math.max(0, Math.floor((Date.now() - start) / 1000)))}`;
}

function sparkline(history) {
  if (!history.length) return '<span class="sparkline-empty">NO RECENT DATA</span>';
  const values = history.map((point) => Number(point.hs || 0));
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.slice().reverse().map((value, index, ordered) => {
    const x = ordered.length === 1 ? 0 : (index / (ordered.length - 1)) * 100;
    const y = 22 - ((value - min) / range) * 18;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-label="Recent hashrate trend"><polyline points="${points}" /></svg>`;
}

function isMoneroAddress(address) {
  return /^(4|8)[1-9A-HJ-NP-Za-km-z]{94,105}$/.test(address);
}

function setApiStatus(label, stateClass) {
  apiStatus.textContent = label;
  apiStatus.className = `api-status ${stateClass}`;
}

function updateSyncIndicator() {
  if (!lastSuccessfulSync || apiStatus.classList.contains('loading')) return;
  const age = Date.now() - lastSuccessfulSync;
  if (age > STALE_AFTER_MS) {
    setApiStatus('STALE DATA', 'stale');
    apiMessage.textContent = `Last successful sync ${formatClock(new Date(lastSuccessfulSync))}. Refresh is still retrying.`;
  }
}

function minerApiUrl(address, path) {
  return `${API_BASE}/${encodeURIComponent(address)}/${path}`;
}

async function refreshPhpRate() {
  try {
    const response = await fetch(PRICE_API);
    if (!response.ok) throw new Error(`Price API returned ${response.status}`);
    const price = await response.json();
    phpPerXmr = Number(price?.monero?.php || price?.phpPerXmr);
    if (!Number.isFinite(phpPerXmr) || phpPerXmr <= 0) phpPerXmr = null;
  } catch (error) {
    phpPerXmr = null;
    console.warn('Could not load PHP conversion rate.', error);
  }
}

function resetEarnings() {
  document.querySelector('#total-paid').textContent = '-- XMR';
  document.querySelector('#balance-due').textContent = '-- XMR';
  document.querySelector('#wallet-hashrate').textContent = '--';
  document.querySelector('#valid-shares').textContent = '--';
}

async function refreshEarnings() {
  const address = walletAddressInput.value.trim();
  state.walletAddress = address;
  saveState();
  if (!address) {
    resetEarnings();
    setApiStatus('NOT CONNECTED', '');
    apiMessage.textContent = 'Enter your wallet address to load earnings.';
    return;
  }
  if (!isMoneroAddress(address)) {
    resetEarnings();
    setApiStatus('INVALID ADDRESS', 'error');
    apiMessage.textContent = 'Enter a valid Monero wallet address (starting with 4 or 8).';
    return;
  }
  if (earningsRequest) earningsRequest.abort();
  earningsRequest = new AbortController();
  setApiStatus('LOADING', 'loading');
  apiMessage.textContent = 'Contacting MoneroOcean...';
  try {
    const response = await fetch(minerApiUrl(address, 'stats'), { signal: earningsRequest.signal });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const stats = await response.json();
    document.querySelector('#total-paid').textContent = formatXmr(stats.amtPaid);
    document.querySelector('#balance-due').textContent = formatXmr(stats.amtDue);
    document.querySelector('#wallet-hashrate').textContent = formatHashrate(stats.hash);
    document.querySelector('#valid-shares').textContent = Number(stats.validShares || 0).toLocaleString();
    state.snapshots.push({ timestamp: Date.now(), amtPaid: stats.amtPaid || 0, amtDue: stats.amtDue || 0, hash: stats.hash || 0, validShares: stats.validShares || 0 });
    state.snapshots = state.snapshots.slice(-288);
    saveState();
    await refreshPhpRate();
    await refreshWorkers(address);
    lastSuccessfulSync = Date.now();
    lastUpdated.textContent = formatClock(new Date(lastSuccessfulSync));
    setApiStatus('CONNECTED', 'connected');
    apiMessage.textContent = `Synced ${formatClock(new Date(lastSuccessfulSync))}. Data supplied by MoneroOcean.`;
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (lastSuccessfulSync) {
      setApiStatus('STALE DATA', 'stale');
      apiMessage.textContent = `Last successful sync ${formatClock(new Date(lastSuccessfulSync))}. Could not reach MoneroOcean.`;
    } else {
      resetEarnings();
      setApiStatus('ERROR', 'error');
      apiMessage.textContent = 'Could not load wallet data. Check the address or try again shortly.';
    }
  }
}

async function refreshWorkers(address) {
  const identifiersResponse = await fetch(minerApiUrl(address, 'identifiers'));
  if (!identifiersResponse.ok) throw new Error(`Worker API returned ${identifiersResponse.status}`);
  const identifiers = await identifiersResponse.json();
  registerDiscoveredMiners(Array.isArray(identifiers) ? identifiers : []);
  const workerResults = await Promise.all(state.miners.map(async (miner) => {
    if (!identifiers.includes(miner.workerId)) return [miner.workerId, { history: [] }];
    const response = await fetch(minerApiUrl(address, `chart/hashrate/${encodeURIComponent(miner.workerId)}`));
    if (!response.ok) return [miner.workerId, { history: [] }];
    const history = (await response.json()).slice(0, 24);
    return [miner.workerId, { history, hashrate: history[0]?.hs || 0 }];
  }));
  const nextWorkerData = new Map(workerResults);
  if (workerData.size) {
    state.miners.forEach((miner) => {
      const wasOnline = isWorkerOnline(workerData.get(miner.workerId));
      const isOnline = isWorkerOnline(nextWorkerData.get(miner.workerId));
      if (wasOnline !== isOnline) {
        state.logs.push({
          name: miner.name,
          online: isOnline,
          timestamp: Date.now(),
          source: 'API'
        });
      }
    });
    state.logs = state.logs.slice(-80);
    saveState();
  }
  workerData = nextWorkerData;
  render();
}

function registerDiscoveredMiners(identifiers) {
  const knownWorkers = new Set(state.miners.map((miner) => miner.workerId));
  const newWorkers = identifiers
    .filter((workerId) => typeof workerId === 'string' && workerId.trim())
    .map((workerId) => workerId.trim())
    .filter((workerId) => !knownWorkers.has(workerId));
  if (!newWorkers.length) return;

  const nextId = state.miners.reduce((highestId, miner) => Math.max(highestId, Number(miner.id) || 0), 0);
  newWorkers.forEach((workerId, index) => {
    state.miners.push({
      id: nextId + index + 1,
      name: workerId,
      workerId,
      anydesk: '',
      online: false,
      totalSeconds: 0,
      onlineSince: null
    });
  });
  saveState();
}

function renderMiners() {
  const maxWindowStart = Math.max(0, state.miners.length - MINER_PAGE_SIZE);
  minerWindowStart = Math.min(minerWindowStart, maxWindowStart);
  const visibleMiners = state.miners.slice(minerWindowStart, minerWindowStart + MINER_PAGE_SIZE);
  minerGrid.innerHTML = visibleMiners.map((miner) => `
    <article class="miner-card ${isWorkerOnline(workerData.get(miner.workerId)) ? 'is-online' : ''}" data-id="${miner.id}">
      <div class="miner-card-top">
        <span class="miner-number">RIG ${String(miner.id).padStart(2, '0')}</span>
        <span class="miner-state"><i class="status-dot ${isWorkerOnline(workerData.get(miner.workerId)) ? 'online' : 'offline'}"></i> ${isWorkerOnline(workerData.get(miner.workerId)) ? 'ONLINE' : 'OFFLINE'}</span>
      </div>
      <div class="name-row">
        <span class="miner-name">${escapeHtml(miner.name)}</span>
        <button class="rename-button" type="button" aria-label="Rename ${escapeHtml(miner.name)}" data-action="rename">EDIT</button>
      </div>
      <button class="anydesk-button" type="button" data-action="copy" aria-label="Copy AnyDesk address ${miner.anydesk}">
        <span class="anydesk-label">ANYDESK</span><strong>${escapeHtml(miner.anydesk)}</strong><span class="copy-state">COPY</span>
      </button>
      <div class="worker-stats"><span>${formatCompactHashrate(workerData.get(miner.workerId)?.hashrate)}</span><span>${formatWorkerDuration(workerData.get(miner.workerId))}</span></div>
      ${sparkline(workerData.get(miner.workerId)?.history || [])}
    </article>
  `).join('');
  minerSlider.max = maxWindowStart;
  minerSlider.value = minerWindowStart;
  minerBrowser.hidden = state.miners.length <= MINER_PAGE_SIZE;
  minerWindow.textContent = `${minerWindowStart + 1}-${Math.min(minerWindowStart + MINER_PAGE_SIZE, state.miners.length)} OF ${state.miners.length}`;
}

function renderSummary() {
  const online = state.miners.filter((miner) => isWorkerOnline(workerData.get(miner.workerId))).length;
  const totalHashrate = state.miners.reduce((sum, miner) => sum + (workerData.get(miner.workerId)?.hashrate || 0), 0);
  const totalMiners = state.miners.length;
  onlineCount.textContent = online;
  offlineCount.textContent = totalMiners - online;
  fleetHashrate.textContent = formatHashrate(totalHashrate);
  onlineTrack.style.width = `${totalMiners ? (online / totalMiners) * 100 : 0}%`;
  document.querySelector('#online-total').textContent = totalMiners;
  document.querySelector('#fleet-count').textContent = totalMiners;
}

function renderLogs() {
  if (!state.logs.length) {
    activityLog.innerHTML = '<div class="empty-log">No worker status changes recorded yet.</div>';
    return;
  }
  activityLog.innerHTML = state.logs.slice().reverse().map((log) => `
    <div class="log-entry">
      <time class="log-time">${formatClock(new Date(log.timestamp))}</time>
      <span><strong>${escapeHtml(log.name)}</strong> ${log.online ? 'came online' : 'went offline'}${log.source ? ' via API' : ''}</span>
      <span class="log-type ${log.online ? 'online' : 'offline'}">${log.online ? 'ONLINE' : 'OFFLINE'}</span>
    </div>
  `).join('');
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function reportRows(period) {
  const now = new Date();
  const start = new Date(now);
  if (period === 'daily') start.setHours(0, 0, 0, 0);
  else start.setDate(1), start.setHours(0, 0, 0, 0);
  const snapshots = state.snapshots.filter((snapshot) => snapshot.timestamp >= start.getTime());
  const logs = state.logs.filter((log) => log.timestamp >= start.getTime());
  const online = state.miners.filter((miner) => isWorkerOnline(workerData.get(miner.workerId))).length;
  const totalHashrate = state.miners.reduce((sum, miner) => sum + (workerData.get(miner.workerId)?.hashrate || 0), 0);
  const latest = snapshots.at(-1) || state.snapshots.at(-1) || {};
  const paidXmr = Number(latest.amtPaid || 0) / ATOMIC_UNITS_PER_XMR;
  const dueXmr = Number(latest.amtDue || 0) / ATOMIC_UNITS_PER_XMR;
  return { now, start, snapshots, logs, online, totalHashrate, latest, paidXmr, dueXmr };
}

function downloadExcel(filename, period) {
  const { now, start, snapshots, logs, online, totalHashrate, latest, paidXmr, dueXmr } = reportRows(period);
  const phpRate = phpPerXmr === null ? '' : Number(phpPerXmr.toFixed(2));
  const section = (title) => `<tr><th colspan="8" class="section">${title}</th></tr>`;
  const cell = (value, className = '') => `<td class="${className}">${escapeHtml(String(value ?? ''))}</td>`;
  const rigRows = state.miners.map((miner) => {
    const worker = workerData.get(miner.workerId);
    return `<tr>${cell(miner.name, 'strong')}${cell(miner.workerId)}${cell(miner.anydesk)}${cell(isWorkerOnline(worker) ? 'ONLINE' : 'OFFLINE', isWorkerOnline(worker) ? 'online' : 'offline')}${cell(worker?.hashrate ? (worker.hashrate / 1000).toFixed(2) : '')}${cell(formatWorkerDuration(worker))}${cell(worker?.history?.[0] ? new Date(worker.history[0].ts).toISOString() : '')}${cell(worker?.history?.length || 0)}</tr>`;
  }).join('');
  const eventRows = logs.length ? logs.map((log) => `<tr>${cell(new Date(log.timestamp).toISOString())}${cell(log.name, 'strong')}${cell(log.online ? 'ONLINE' : 'OFFLINE', log.online ? 'online' : 'offline')}${cell(log.source || 'LOCAL')}</tr>`).join('') : `<tr>${cell('No status changes in this period', 'muted')}<td colspan="3"></td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#17212b;margin:28px;background:#fff}h1{color:#123149;margin:0 0 4px;font-size:24px}p{color:#5d6b75;margin:4px 0 20px}table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:20px}th,td{border:1px solid #cbd5dc;padding:8px 10px;text-align:left;vertical-align:middle}th{background:#e8f0f5;color:#123149;font-weight:600}th.section{background:#123149;color:#fff;border-color:#123149;text-transform:uppercase;letter-spacing:1px;padding:10px;text-align:left}.meta td:first-child{background:#f3f6f8;font-weight:600;color:#53636e;width:150px}.strong{font-weight:600}.online{color:#075985;font-weight:700;background:#e4f4fb}.offline{color:#b42318;font-weight:700;background:#fff0ee}.num{text-align:right}.muted{color:#71808a;font-style:italic}small{color:#6c7b84}
  </style></head><body><h1>XMR MONERO MINER</h1><p>Operations report | ${period === 'daily' ? 'Daily' : 'Monthly'} | Generated ${now.toISOString()}</p>
  <table class="meta"><tr><th colspan="4">REPORT INFORMATION</th></tr><tr>${cell('Period start', 'strong')}${cell(start.toISOString())}${cell('Period end', 'strong')}${cell(now.toISOString())}</tr><tr>${cell('Wallet address', 'strong')}<td colspan="3">${escapeHtml(state.walletAddress)}</td></tr><tr>${cell('XMR to PHP rate', 'strong')}${cell(phpRate ? `PHP ${phpRate.toFixed(2)}` : 'Unavailable')}${cell('Snapshots', 'strong')}${cell(snapshots.length)}</tr></table>
  <table>${section('EARNINGS SUMMARY')}<tr><th>Metric</th><th>Amount (XMR)</th><th>Amount (PHP)</th><th>Valid shares</th></tr><tr>${cell('Total paid', 'strong')}${cell(paidXmr.toFixed(12), 'num')}${cell(phpRate === '' ? 'Unavailable' : `PHP ${(paidXmr * phpPerXmr).toFixed(2)}`, 'num')}${cell(Number(latest.validShares || 0).toLocaleString(), 'num')}</tr><tr>${cell('Balance due', 'strong')}${cell(dueXmr.toFixed(12), 'num')}${cell(phpRate === '' ? 'Unavailable' : `PHP ${(dueXmr * phpPerXmr).toFixed(2)}`, 'num')}${cell('', 'num')}</tr></table>
  <table>${section('FLEET SUMMARY')}<tr><th>Online rigs</th><th>Offline rigs</th><th>Fleet hashrate</th><th>Currency</th></tr><tr>${cell(online, 'num')}${cell(state.miners.length - online, 'num')}${cell(`${(totalHashrate / 1000).toFixed(2)} kH/s`)}${cell('PHP')}</tr></table>
  <table>${section('RIG STATUS')}<tr><th>Rig name</th><th>Worker ID</th><th>AnyDesk</th><th>Status</th><th>Hashrate (kH/s)</th><th>Online duration</th><th>Last sample (UTC)</th><th>Trend points</th></tr>${rigRows}</table>
  <table>${section('STATUS EVENTS')}<tr><th>Timestamp (UTC)</th><th>Rig</th><th>Event</th><th>Source</th></tr>${eventRows}</table><small>Generated locally. Earnings data supplied by MoneroOcean. PHP conversion is based on the latest available market rate.</small></body></html>`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function exportReport() {
  const period = document.querySelector('#report-period').value;
  const now = new Date();
  const start = new Date(now);
  if (period === 'daily') start.setHours(0, 0, 0, 0);
  else start.setDate(1), start.setHours(0, 0, 0, 0);
  const snapshots = state.snapshots.filter((snapshot) => snapshot.timestamp >= start.getTime());
  const logs = state.logs.filter((log) => log.timestamp >= start.getTime());
  const online = state.miners.filter((miner) => isWorkerOnline(workerData.get(miner.workerId))).length;
  const totalHashrate = state.miners.reduce((sum, miner) => sum + (workerData.get(miner.workerId)?.hashrate || 0), 0);
  const latest = snapshots.at(-1) || state.snapshots.at(-1) || {};
  const periodStart = start.toISOString();
  const periodEnd = now.toISOString();
  const paidXmr = Number(latest.amtPaid || 0) / ATOMIC_UNITS_PER_XMR;
  const dueXmr = Number(latest.amtDue || 0) / ATOMIC_UNITS_PER_XMR;
  const phpRate = phpPerXmr === null ? '' : Number(phpPerXmr.toFixed(2));
  const label = period === 'daily' ? now.toISOString().slice(0, 10) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rows = [
    ['XMR MONERO MINER - OPERATIONS REPORT'],
    ['REPORT INFORMATION'],
    ['Report type', period === 'daily' ? 'Daily' : 'Monthly', 'Period start', periodStart, 'Period end', periodEnd],
    ['Generated at', now.toISOString(), 'Wallet address', state.walletAddress],
    ['XMR to PHP rate', phpRate, 'Currency', 'PHP'],
    [],
    ['EARNINGS SUMMARY'],
    ['Metric', 'Amount (XMR)', 'Amount (PHP)', 'Snapshot count'],
    ['Total paid', Number(paidXmr.toFixed(12)), phpRate === '' ? '' : Number((paidXmr * phpPerXmr).toFixed(2)), snapshots.length],
    ['Balance due', Number(dueXmr.toFixed(12)), phpRate === '' ? '' : Number((dueXmr * phpPerXmr).toFixed(2)), snapshots.length],
    ['Valid shares', Number(latest.validShares || 0), '', snapshots.length],
    [],
    ['FLEET SUMMARY'],
    ['Metric', 'Value', 'Unit'],
    ['Online rigs', online, 'rigs'],
    ['Offline rigs', state.miners.length - online, 'rigs'],
    ['Fleet hashrate', Number((totalHashrate / 1000).toFixed(2)), 'kH/s'],
    [],
    ['RIG STATUS'],
    ['Rig name', 'Worker ID', 'AnyDesk', 'Status', 'Hashrate (kH/s)', 'Online duration', 'Last sample (UTC)', 'Trend points'],
    ...state.miners.map((miner) => {
      const worker = workerData.get(miner.workerId);
      return [miner.name, miner.workerId, miner.anydesk, isWorkerOnline(worker) ? 'ONLINE' : 'OFFLINE', worker?.hashrate ? Number((worker.hashrate / 1000).toFixed(2)) : '', formatWorkerDuration(worker), worker?.history?.[0] ? new Date(worker.history[0].ts).toISOString() : '', worker?.history?.length || 0];
    }),
    [],
    ['STATUS EVENTS'],
    ['Timestamp (UTC)', 'Rig', 'Event', 'Source'],
    ...logs.map((log) => [new Date(log.timestamp).toISOString(), log.name, log.online ? 'ONLINE' : 'OFFLINE', log.source || 'LOCAL'])
  ];
  downloadCsv(`xmr-miner-report-${period}-${label}.csv`, rows);
}

function render() {
  renderMiners();
  renderSummary();
  renderLogs();
}

function renameMiner(card, miner) {
  const nameElement = card.querySelector('.miner-name');
  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = miner.name;
  input.maxLength = 28;
  nameElement.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const nextName = input.value.trim();
    if (nextName) miner.name = nextName;
    saveState();
    render();
  };
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') { input.value = miner.name; input.blur(); }
  });
}

async function copyAddress(card, miner) {
  try {
    await navigator.clipboard.writeText(miner.anydesk);
    const copyState = card.querySelector('.copy-state');
    copyState.textContent = 'COPIED';
    setTimeout(() => { copyState.textContent = 'COPY'; }, 1500);
  } catch (error) {
    console.warn('Could not copy AnyDesk address.', error);
  }
}

minerGrid.addEventListener('click', (event) => {
  const card = event.target.closest('.miner-card');
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!card || !action) return;
  const miner = state.miners.find((item) => item.id === Number(card.dataset.id));
  if (action === 'rename') renameMiner(card, miner);
  if (action === 'copy') copyAddress(card, miner);
});

minerSlider.addEventListener('input', () => {
  minerWindowStart = Number(minerSlider.value);
  renderMiners();
});

document.querySelector('#clear-logs').addEventListener('click', () => {
  state.logs = [];
  saveState();
  renderLogs();
});
document.querySelector('#export-report').addEventListener('click', exportReport);
document.querySelector('#export-excel').addEventListener('click', () => {
  const period = document.querySelector('#report-period').value;
  const dateLabel = new Date().toISOString().slice(0, period === 'daily' ? 10 : 7);
  downloadExcel(`xmr-miner-report-${period}-${dateLabel}.xls`, period);
});

walletAddressInput.value = state.walletAddress;
document.querySelector('#refresh-earnings').addEventListener('click', refreshEarnings);
walletAddressInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') refreshEarnings();
});
if (state.walletAddress) refreshEarnings();
setInterval(() => {
  if (state.walletAddress && isMoneroAddress(state.walletAddress)) refreshEarnings();
}, 300000);
setInterval(updateSyncIndicator, 1000);

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

render();
setInterval(() => {
  renderSummary();
  document.querySelectorAll('.miner-card').forEach((card) => {
    const miner = state.miners.find((item) => item.id === Number(card.dataset.id));
    card.querySelector('.worker-stats span:last-child').textContent = formatWorkerDuration(workerData.get(miner.workerId));
  });
  updateSyncIndicator();
}, 1000);
