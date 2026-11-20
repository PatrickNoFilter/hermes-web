# Hermes Web (standalone app)

A standalone desktop app for the **official Hermes Web Dashboard**. It does not
reimplement any UI: it starts (or reuses) the real `hermes dashboard` server on
127.0.0.1:9119 and loads its web app in a native Electron window. Functionality
is identical to the official web dashboard by construction — chat, sessions,
files, models, logs, cron, skills, plugins, MCP, channels, webhooks, pairing,
profiles, config, keys, system.

## Download

Prebuilt **Linux x64** zip on the [Releases page](https://github.com/PatrickNoFilter/hermes-web/releases):
unzip it and run `./hermes-web`. The `hermes` CLI must be installed on the
machine — the app starts (or reuses) the official dashboard server.

## Run

- App menu: **Hermes Web** (`~/.local/share/applications/hermes-web.desktop`)
- Terminal: `hermes-web` (wrapper in `~/.local/bin`)
- Deep link: `hermes-web /chat` opens the Chat tab directly

## How it works

- `main.js` probes port 9119; if down it spawns `hermes dashboard --no-open
  --skip-build` (falls back to an auto-build launch if the UI dist is missing).
- Loopback auth is automatic: the dashboard injects its session token into the
  SPA HTML, so loading the page signs the window in exactly like a browser.
- Closing the window leaves the machine-level dashboard server running (other
  clients may share it; it has its own idle-exit).
- Single-instance: a second launch focuses the existing window.
- Logs: `~/.hermes/logs/hermes-web-app.log`; a verification screenshot is saved
  to `~/.hermes/logs/hermes-web-verify.png` on each launch.

## Maintain

- Electron runtime: `node_modules/electron` (update with `npm install` here).
- The dashboard backend/UI updates come from `hermes update` — nothing in this
  app needs to change to pick them up.