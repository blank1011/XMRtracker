# XMR MONERO MINER

A local mining operations dashboard for tracking a MoneroOcean wallet and its miner fleet.

## What It Does

- Connects to the MoneroOcean wallet API.
- Automatically discovers active `aoi1` through `aoi26` workers.
- Shows live online/offline status, hashrate, online duration, and per-worker trend lines.
- Displays AnyDesk addresses with click-to-copy controls.
- Automatically assigns the supplied AnyDesk address list to the detected aoi workers.
- Shows total paid, balance due, pool hashrate, valid shares, and a live XMR-to-PHP converter.
- Stores local earnings snapshots and API status-change logs in the browser.
- Provides an expandable earnings history chart with XMR/PHP and metric selectors.
- Exports daily or monthly CSV and styled Excel-compatible reports.
- Uses a navy and red dashboard theme with responsive desktop and mobile layouts.

## Run Locally

Requirements: Node.js 18 or newer.

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000).

The local Node server proxies MoneroOcean and CoinGecko requests, serves the static dashboard, and stores local snapshot history in `data/history.json`. That history file is intentionally ignored by Git.

## Deployment

The project includes Vercel serverless API functions and `vercel.json` routing. The frontend assets are served statically, while the API routes proxy:

- `/api/miner/...`
- `/api/price/php`
- `/api/history/...`

The public wallet address is stored in browser local storage. No private keys, seed phrases, or mining credentials are used.

## Important Notes

- Online status is based on recent accepted MoneroOcean worker data, not AnyDesk connectivity.
- The AnyDesk list is managed separately from worker names because MoneroOcean does not provide AnyDesk information.
- CPU temperature is not included yet. It will require a local hardware-monitoring agent such as LibreHardwareMonitor on each Windows rig.
- Earnings charts become more useful as the dashboard collects more snapshots over time.
