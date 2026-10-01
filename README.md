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

## Remote Miner Controls

Remote controls use the Vercel function at `/api/miner-control` and a Supabase table. The Windows agents make outbound HTTPS requests; no router port forwarding is required.

1. In Supabase, run [`supabase/miner-controls.sql`](supabase/miner-controls.sql) in the SQL Editor.
2. Add these Vercel environment variables:
	- `SUPABASE_URL`: the Supabase project URL.
	- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key. Keep it only in Vercel environment settings.
	- `CONTROL_ADMIN_KEY`: a long random secret used by dashboard operators.
	- `CONTROL_AGENT_TOKENS`: a JSON object mapping each worker ID to a different long random secret, for example `{"aoi1":"...","aoi2":"..."}`.
	- `CONTROL_AGENT_TOKENS_ADDITIONAL`: optional JSON map for adding or rotating worker tokens without replacing the original map; duplicate worker IDs in this map override the original map.
	Generate a new secret for each value in PowerShell with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep the admin key and agent tokens private; do not commit them or send them in chat.
3. Redeploy the Vercel project. The dashboard prompts for `CONTROL_ADMIN_KEY` when a control is first used in a browser tab.
4. On each Windows rig, copy [`install-miner-control-agent.cmd`](install-miner-control-agent.cmd) and double-click it. Approve the Windows elevation prompt so the agent can manage a miner running as Administrator. Enter the deployed HTTPS URL, that rig's worker ID, executable path, miner arguments/config path, and its matching agent token when prompted. The installer stores the token encrypted for the current Windows user and starts the agent at sign-in with highest privileges.

The endpoint uses the admin secret for dashboard commands and a separate per-rig token for agent polling. `SUPABASE_SERVICE_ROLE_KEY` must never be placed in browser code or on a rig. Test with one rig before configuring the fleet. The agent only stops the configured executable path; provide the miner's existing config arguments before sending a resume command. The installer registers a Windows Scheduled Task under the current user; rerun the file to change that rig's settings.

The public wallet address is stored in browser local storage. No private keys, seed phrases, or mining credentials are used.

## Important Notes

- Online status is based on recent accepted MoneroOcean worker data, not AnyDesk connectivity.
- The AnyDesk list is managed separately from worker names because MoneroOcean does not provide AnyDesk information.
- CPU temperature is not included yet. It will require a local hardware-monitoring agent such as LibreHardwareMonitor on each Windows rig.
- Earnings charts become more useful as the dashboard collects more snapshots over time.
