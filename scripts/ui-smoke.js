#!/usr/bin/env node
/**
 * ui-smoke.js — Headless browser smoke test for design tokens + dark mode
 * (UI improvement plan stages 1–2, docs/ui-improvement-plan.md).
 *
 * Usage: node scripts/ui-smoke.js
 * Requires chromium (skips gracefully if absent). Zero dependencies:
 * serves the repo over localhost and drives chromium via raw CDP.
 *
 * Exit 0 = pass (or skipped), 1 = failures.
 */

const { spawn, spawnSync } = require('child_process');
const os = require('os');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const findBrowser = () => {
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      const r = spawnSync(bin, ['--version']);
      if (r.status === 0) return bin;
    } catch (_err) { /* keep looking */ }
  }
  return null;
};

const browser = findBrowser();
if (!browser) {
  console.log('SKIP  chromium not found — install chromium to run the smoke test');
  process.exit(0);
}

const port = 8317 + Math.floor(Math.random() * 40);
const cdpPort = 9317 + Math.floor(Math.random() * 40);
const pageUrl = `http://127.0.0.1:${port}/index.html`;

// ── Local static server ─────────────────────────────────────────

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getJSON = async (u) => (await fetch(u)).json();

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}`);
  if (!ok) failures++;
};

(async () => {
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  // Throwaway profile: never touch the user's real Chromium profile (a running
  // browser holds its singleton lock and a shared-profile launch would hang).
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpl-smoke-'));
  const chromium = spawn(
    browser,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
     `--user-data-dir=${profileDir}`,
     `--remote-debugging-port=${cdpPort}`, '--window-size=1280,900', pageUrl],
    { stdio: 'ignore' }
  );
  // Global watchdog: a page that spins the main thread (e.g. a mutation
  // feedback loop) must never hang the test suite.
  const watchdog = setTimeout(() => {
    console.error('\x1b[31msmoke test global timeout (120s)\x1b[0m');
    process.exit(1);
  }, 120000);

  try {
    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try {
        const targets = await getJSON(`http://127.0.0.1:${cdpPort}/json`);
        target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch (_err) { /* not ready yet */ }
    }
    if (!target) {
      check('CDP endpoint reachable', false);
      return;
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let msgId = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++msgId;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out after 15s`));
        }
      }, 15000);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.method || 'cdp'}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    };
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('websocket failed to open'));
    });
    await send('Runtime.enable');

    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || 'page exception');
      }
      return r.result.value;
    };

    // Wait for rendered content (content.json is fetched client-side).
    let rendered = false;
    for (let i = 0; i < 40; i++) {
      rendered = await evalJs(
        `!!document.querySelector('.site-header') && document.querySelectorAll('.card, .tile, .carousel-slide').length > 0`
      );
      if (rendered) break;
      await sleep(500);
    }
    check('page renders header + project content', rendered);

    const initialTheme = await evalJs(`document.documentElement.getAttribute('data-theme')`);
    check('bootstrap sets theme before paint', ['light', 'dark'].includes(initialTheme));
    check('theme toggle button in header', await evalJs(`!!document.querySelector('header button[data-theme-toggle]')`));

    const lightBg = await evalJs(`getComputedStyle(document.body).backgroundImage`);
    const accent = await evalJs(`getComputedStyle(document.body).color`);
    check('body text color resolves', /^rgb/.test(accent));

    await evalJs(`document.querySelector('button[data-theme-toggle]').click(); true`);
    const themeAfterClick = await evalJs(`document.documentElement.getAttribute('data-theme')`);
    const other = initialTheme === 'dark' ? 'light' : 'dark';
    check(`click toggles to ${other}`, themeAfterClick === other);
    check('choice persisted to localStorage', (await evalJs(`localStorage.getItem('pnpl_theme_v1')`)) === other);

    const otherBg = await evalJs(`getComputedStyle(document.body).backgroundImage`);
    check('body background changes between themes', lightBg !== otherBg);
    const accentAfter = await evalJs(`getComputedStyle(document.querySelector('.cta') || document.body).color`);
    check('accent color resolves in toggled theme', /^rgb/.test(accentAfter));

    await evalJs(`document.querySelector('button[data-theme-toggle]').click(); true`);
    check('second click restores theme', (await evalJs(`document.documentElement.getAttribute('data-theme')`)) === initialTheme);
    check('aria-label reflects current state', /Switch to (light|dark) theme/.test(await evalJs(`document.querySelector('button[data-theme-toggle]').getAttribute('aria-label')`)));

    // ── Stage 3: header/nav streamlining ───────────────────────────
    const navLabels = JSON.parse(await evalJs(
      `JSON.stringify(Array.from(document.querySelectorAll('.site-header .nav > a')).map((a) => a.textContent.trim()))`
    ));
    check('stage3: CTA button in header', await evalJs(`!!document.querySelector('.site-header .nav-cta')`));
    check('stage3: CTA links to submit.html', (await evalJs(`document.querySelector('.site-header .nav-cta')?.getAttribute('href')`)).includes('submit.html'));
    check('stage3: no Submit/Watchlist nav pills', !navLabels.includes('Submit a Project') && !navLabels.includes('Watchlist'));
    check('stage3: Archive pill present', navLabels.includes('Archive'));
    check('stage3: watchlist icon button present', await evalJs(`!!document.querySelector('.site-header .watchlist-nav')`));
    const badgeSel = `document.querySelector('.watchlist-nav [data-watchlist-count]')`;
    check('stage3: watch badge hidden at count 0', await evalJs(`${badgeSel}.hidden === true`));
    await evalJs(`localStorage.setItem('pnpl_watchlist_v1', JSON.stringify(['x'])); window.dispatchEvent(new StorageEvent('storage', { key: 'pnpl_watchlist_v1' })); true`);
    check('stage3: watch badge updates on storage event', await evalJs(`${badgeSel}.textContent === '1' && !${badgeSel}.hidden`));
    await evalJs(`document.querySelector('.tools-menu')?.setAttribute('open', ''); true`);
    const toolLabels = JSON.parse(await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.site-header .tools-list a')).map((a) => a.textContent.trim()))`));
    check('stage3: tools list includes BoardSplitter/TokenMaker/DiceMaker', ['BoardSplitter', 'TokenMaker', 'DiceMaker'].every((t) => toolLabels.includes(t)));
    check('stage3: footer tools list in sync', (await evalJs(`document.querySelectorAll('.footer-tools a').length`)) === toolLabels.length);

    ws.close();
  } finally {
    clearTimeout(watchdog);
    chromium.kill('SIGKILL');
    server.close();
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_err) { /* best effort */ }
  }

  console.log('');
  console.log(failures ? `\x1b[31m${failures} smoke check(s) failed\x1b[0m` : '\x1b[32mall smoke checks passed\x1b[0m');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(`\x1b[31msmoke test error: ${err.message}\x1b[0m`);
  process.exit(1);
});
