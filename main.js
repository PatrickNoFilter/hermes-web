// Hermes Web — standalone shell around the OFFICIAL Hermes Web Dashboard.
// It does not reimplement any UI: it starts (or reuses) the real `hermes dashboard`
// server and loads its web app in a native window, so functionality is identical
// to the official web dashboard by construction.
const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 9119;
app.setName('Hermes Web');
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.homedir(), '.hermes', 'logs', 'hermes-web-app.log');

let win = null;
let serverChild = null;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG, line); } catch {}
  console.log(msg);
}

// Resolve the hermes CLI the same way the user's shell does.
function hermesBin() {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'hermes'),
    '/usr/local/bin/hermes',
    '/usr/bin/hermes',
  ];
  for (const c of candidates) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {} }
  return 'hermes'; // fall back to PATH
}

function probe(pathname = '/', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverUp() {
  const code = await probe('/');
  return code > 0 && code < 500; // any HTTP answer means the listener is alive
}

async function ensureServer() {
  if (await serverUp()) { log('dashboard already running — reusing it'); return true; }
  log('starting official hermes dashboard server…');
  const out = fs.openSync(LOG, 'a');
  const launch = (extraArgs) => {
    const c = spawn(hermesBin(), ['dashboard', '--no-open', ...extraArgs], {
      detached: true, stdio: ['ignore', out, out], env: { ...process.env },
    });
    c.unref();
    return c;
  };
  serverChild = launch(['--skip-build']);
  // Wait up to 60s for the listener.
  for (let i = 0; i < 60; i++) {
    if (await serverUp()) { log('dashboard is up'); return true; }
    await sleep(1000);
  }
  // Fallback: UI dist may be missing/stale (e.g. after an update) — let the
  // dashboard run its own build gate, which provisions Node/pnpm as needed.
  log('not up with --skip-build; retrying with auto-build…');
  serverChild = launch([]);
  for (let i = 0; i < 240; i++) {
    if (await serverUp()) { log('dashboard is up (after build)'); return true; }
    await sleep(1000);
  }
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'Hermes Web',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The dashboard's embedded chat uses PTY-over-WebSocket; default web
      // security stays on — same origin as the official browser experience.
    },
  });
  win.setMenuBarVisibility(false);

  // Keep in-app navigation inside the window; send external links to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(BASE)) { e.preventDefault(); shell.openExternal(url); }
  });

  win.on('closed', () => { win = null; });
  return win;
}

async function boot() {
  createWindow();
  // Loading screen while the backend comes up.
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="background:#0b0d10;color:#d7dde3;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
     <div style="text-align:center"><div style="font-size:28px;letter-spacing:2px">HERMES WEB</div>
     <div style="margin-top:12px;color:#8a949e">Starting the official Hermes dashboard…</div></div></body></html>`
  ));
  const ok = await ensureServer();
  if (!ok) {
    dialog.showErrorBox('Hermes Web', 'Could not start the Hermes dashboard server.\nSee ~/.hermes/logs/hermes-web-app.log');
    app.quit();
    return;
  }
  // Optional deep link: `hermes-web /chat` opens that dashboard page.
  const argPath = process.argv.slice(2).find((a) => a.startsWith('/') && !a.startsWith('//') && a !== __dirname);
  const startUrl = BASE + (argPath || '');
  log('loading ' + startUrl);
  win.loadURL(startUrl);
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log('page console: ' + message.slice(0, 300));
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 4000)); // let SPA data fetches settle
      const info = await win.webContents.executeJavaScript(
        `JSON.stringify({title: document.title, url: location.href, bodyLen: document.body.innerText.length, sample: document.body.innerText.slice(0, 600)})`
      );
      log('page loaded: ' + info);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(os.homedir(), '.hermes', 'logs', 'hermes-web-verify.png'), img.toPNG());
      log('verification screenshot saved');
    } catch (e) { log('verify failed: ' + e.message); }
  });
}

// Single instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(boot);
  app.on('window-all-closed', () => {
    // Leave the machine-level dashboard server running (other clients may use it;
    // it has its own idle-exit). Just close the app.
    app.quit();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
}