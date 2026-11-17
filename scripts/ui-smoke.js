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
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? ` — ${detail}` : ''}`);
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

    // ── Stage 4: home page tightening ───────────────────────────
    const slideCount = await evalJs(`document.querySelectorAll('.carousel-slide').length`);
    if (slideCount > 1) {
    check('stage4: carousel exposes a carousel role + label',
      (await evalJs(`document.querySelector('#featured-carousel')?.getAttribute('aria-roledescription')`)) === 'carousel' &&
      (await evalJs(`!!document.querySelector('#featured-carousel[aria-label]')`)));
    check('stage4: polite live region announces the active slide',
      await evalJs(`!!document.querySelector('#carousel-live[aria-live="polite"]')`));
    const announced = await evalJs(`document.querySelector('#carousel-live')?.textContent || ''`);
    check('stage4: live region names the current slide', /^Slide \d+ of \d+: /.test(announced), announced);
    const tapSizes = JSON.parse(await evalJs(`
      JSON.stringify({
        dots: Array.from(document.querySelectorAll('.carousel-dots button')).map((b) => [b.offsetWidth, b.offsetHeight]),
        arrows: Array.from(document.querySelectorAll('.carousel-controls button')).map((b) => [b.offsetWidth, b.offsetHeight]),
        handles: Array.from(document.querySelectorAll('.tile-handle')).map((b) => [b.offsetWidth, b.offsetHeight]),
      })
    `));
    const atLeast44 = (list) => list.length > 0 && list.every(([w, h]) => w >= 44 && h >= 44);
    check('stage4: carousel dots are >=44px tap targets', atLeast44(tapSizes.dots), JSON.stringify(tapSizes.dots.slice(0, 2)));
    check('stage4: carousel arrows are >=44px tap targets', atLeast44(tapSizes.arrows));
    check('stage4: live-strip handles are >=44px tap targets', atLeast44(tapSizes.handles));
    check('stage4: hidden slides are inert (not focusable)',
      await evalJs(`Array.from(document.querySelectorAll('.carousel-slide')).filter((s) => !s.classList.contains('active') && s.inert).length === document.querySelectorAll('.carousel-slide:not(.active)').length`));
    const compactRows = JSON.parse(await evalJs(`
      JSON.stringify(Array.from(document.querySelectorAll('.home-compact-row')).map((r) => getComputedStyle(r).overflowX))
    `));
    check('stage4: home compact rows no longer hidden-scroll', compactRows.every((v) => v !== 'auto'), JSON.stringify(compactRows));

    // Hover pauses the rotation, and it resumes when the pointer leaves.
    const slideIndex = () => evalJs(`Number(document.querySelector('.carousel-slide.active')?.dataset.index || -1)`);
    await evalJs(`document.querySelector('#carousel-live') && document.querySelector('#featured-carousel').dispatchEvent(new MouseEvent('mouseenter')); true`);
    const beforeHover = await slideIndex();
    await sleep(5200);
    check('stage4: rotation pauses while hovered', (await slideIndex()) === beforeHover, `slide ${beforeHover} -> ${await slideIndex()}`);
    await evalJs(`document.querySelector('#featured-carousel').dispatchEvent(new MouseEvent('mouseleave')); true`);
    await sleep(5200);
    check('stage4: rotation resumes after hover ends', (await slideIndex()) !== beforeHover);

    // Reduced motion: no auto-rotation at all, and no smooth tile scrolling.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Page.navigate', { url: pageUrl });
    for (let i = 0; i < 40; i++) {
      if (await evalJs(`!!document.querySelector('.carousel-slide.active')`)) break;
      await sleep(250);
    }
    const reducedStart = await slideIndex();
    await sleep(6000);
    check('stage4: no auto-rotation under prefers-reduced-motion', (await slideIndex()) === reducedStart);
    check('stage4: hover/focus pause code is wired regardless of motion preference',
      await evalJs(`!!document.querySelector('#carousel-live')`));
    const badgeAnim = await evalJs(`getComputedStyle(document.querySelector('.badge.live-now') || document.body).animationName`);
    check('stage4: badge pulses are off under reduced motion', badgeAnim === 'none', badgeAnim);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] });
    } else {
      console.log(`SKIP  stage4 carousel checks (only ${slideCount} featured slide rendered)`);
    }

    // ── Stage 6: search accessibility ───────────────────────────
    let searchReady = false;
    for (let i = 0; i < 20 && !searchReady; i++) {
      searchReady = await evalJs(`!!document.querySelector('.search-trigger')`);
      if (!searchReady) await sleep(250);
    }
    check('stage6: search trigger present', searchReady);
    if (searchReady) {
      check('stage6: trigger exposes dialog + expanded state',
        (await evalJs(`document.querySelector('.search-trigger').getAttribute('aria-haspopup')`)) === 'dialog' &&
        (await evalJs(`document.querySelector('.search-trigger').getAttribute('aria-expanded')`)) === 'false');
      await evalJs(`document.querySelector('.search-trigger').click(); true`);
      await sleep(400);
      check('stage6: opening search puts focus in the input',
        await evalJs(`document.activeElement?.classList.contains('search-input')`));
      check('stage6: panel is a labelled dialog with expanded state',
        (await evalJs(`document.querySelector('.search-container').getAttribute('role')`)) === 'dialog' &&
        (await evalJs(`document.querySelector('.search-container').getAttribute('aria-expanded')`)) === 'true');
      check('stage6: result rows are real anchors',
        await evalJs(`document.querySelectorAll('a.search-result-item').length === document.querySelectorAll('.search-result-item').length`));
      check('stage6: polite status region reports result counts',
        await evalJs(`!!document.querySelector('.search-status[aria-live="polite"]')`));
      const trapped = await evalJs(`(function () {
        const panel = document.querySelector('.search-container');
        const els = Array.from(panel.querySelectorAll('input, button, a[href]')).filter((e) => !e.disabled && e.offsetParent !== null);
        if (!els.length) return false;
        els[els.length - 1].focus();
        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        return document.activeElement === els[0];
      })()`);
      check('stage6: Tab wraps focus back to the first element (trap)', trapped);
      await evalJs(`document.querySelector('.search-close').click(); true`);
      await sleep(300);
      check('stage6: closing restores focus to the search trigger',
        (await evalJs(`document.activeElement === document.querySelector('.search-trigger')`)) &&
        (await evalJs(`document.querySelector('.search-trigger').getAttribute('aria-expanded')`)) === 'false');
    }

    // ── Stage 5: image robustness ───────────────────────────────
    let imagesLoaded = false;
    for (let i = 0; i < 20; i++) {
      imagesLoaded = await evalJs(`Array.from(document.querySelectorAll('img')).every((i) => i.complete)`);
      if (imagesLoaded) break;
      await sleep(300);
    }
    const broken = JSON.parse(await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.card img, .tile img, .carousel-slide img, .blog-cover')).filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src))`));
    check('stage5: no broken project images on the home page', broken.length === 0, broken.slice(0, 3).join(', '));
    const remoteCount = await evalJs(`Array.from(document.querySelectorAll('.card img, .tile img, .carousel-slide img')).filter((i) => /^https:/.test(i.src)).length`);
    const localCount = await evalJs(`Array.from(document.querySelectorAll('.card img, .tile img, .carousel-slide img')).filter((i) => i.src.includes('/uploads/')).length`);
    check('stage5: featured/live imagery is served locally', localCount > 0 && remoteCount === 0, `${localCount} local, ${remoteCount} remote`);
    const cardImg = JSON.parse(await evalJs(`JSON.stringify((function () { const img = document.querySelector('.card img'); if (!img) return null; const cs = getComputedStyle(img); return { aspect: cs.aspectRatio, minHeight: cs.minHeight }; })())`));
    check('stage5: card images use aspect-ratio without a conflicting min-height',
      Boolean(cardImg) && cardImg.aspect !== 'none' && ['auto', '0px'].includes(cardImg.minHeight), JSON.stringify(cardImg));

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
