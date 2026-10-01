# XMR Tracker Miner-Control Handoff

Updated: 2026-10-01

## Current Status

- Production dashboard: https://xmr-tracker.vercel.app/
- Git branch: `main`; latest pushed handoff commit: `f1611bf` (`Add miner control handoff notes`).
- Vercel production deployment for the elevated installer commit was observed as Ready.
- Supabase project `xmrtracker-control` contains `public.worker_controls`; row-level security is enabled, client roles are revoked, and the server `service_role` has only the select/insert/update privileges the API needs.
- Production environment variables are configured in Vercel. Secret values are deliberately not recorded here.

## Implemented

- Dashboard supports per-rig and fleet pause/resume commands.
- `/api/miner-control` authenticates dashboard writes with `CONTROL_ADMIN_KEY` and agent reads with per-worker tokens. `CONTROL_AGENT_TOKENS_ADDITIONAL` can add workers without replacing the base token map.
- Supabase persists the latest command. Fleet commands apply unless a newer per-worker command overrides them.
- `install-miner-control-agent.cmd` is the single click-to-run Windows installer. It prompts for the HTTPS API URL, worker ID, miner executable/arguments, and that worker's token; it registers an at-sign-in task at highest privileges after UAC approval.
- Local verification covered JavaScript/PowerShell syntax, Vercel config, API authorization, database access, and live production reads.

## Rig 1 Findings

- The supplied agent token is registered for worker `aoi12`. A live production GET authenticated as `aoi12` returned HTTP 200; the same token under `aoi1` returned HTTP 401.
- The saved `aoi12` state was observed as `paused` at 2026-10-01 08:18 UTC, then `running` at 08:31 UTC. It was not confirmed that the physical miner stopped.
- The current VS Code PC has no local agent config, so the rig itself was not directly inspected. Vercel runtime-log UI did not provide usable per-worker rows during troubleshooting.
- The installer previously registered a limited-privilege task. Commit `72d0fb3` changes it to request elevation and run at highest privileges.
- New user observation: clicking Pause updates the dashboard/control record, but an already-running miner continues mining. If the miner is closed and manually launched again while its record is paused, the agent prevents it from continuing. Desired behavior is to pause the existing process and later resume that same process, not kill it and rely on a relaunch.
- The current agent uses `Stop-Process` for the configured executable and `Start-Process` on resume. That is stop/relaunch behavior, not in-place pause/resume. Elevation and worker authentication do not implement in-place process suspension.

## Next Steps

1. On the mining rig, run the latest `install-miner-control-agent.cmd` as Administrator and approve UAC.
2. Enter worker ID exactly `aoi12`, plus the already-registered token for that worker. Do not use the dashboard control key as the agent token.
3. Redesign the agent's control action to pause and resume the same running miner process (or use a supported miner control API); do not treat a database `paused` flag as proof the miner stopped.
4. Test against the already-running `aoi12` process: Pause should stop its mining activity without terminating it, and Resume should continue that same process. Also test cold-start behavior and confirm the executable path/process identity matches the rig.
5. Keep this file free of API keys and tokens. Rotate the worker token if it needs to be replaced.

## Secrets

The untracked root-level `password` file is intentionally ignored by Git. API keys and tokens remain in Vercel/Supabase settings or on the rig; they are not included in this handoff or the repository.