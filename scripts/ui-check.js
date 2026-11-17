#!/usr/bin/env node
/**
 * ui-check.js — Static checks for the shared design system + dark mode
 * (UI improvement plan stages 1–2, docs/ui-improvement-plan.md).
 *
 * Usage: node scripts/ui-check.js
 * Exit 0 = all checks pass, 1 = failures.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const reads = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
};

// ── CSS helpers ──────────────────────────────────────────────────

// Extract the body of the first top-level block whose selector line matches `selectorRe`.
function extractBlock(css, selectorRe) {
  const start = css.search(selectorRe);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

// ── 1. styles.css: theme blocks ─────────────────────────────────

const css = reads('assets/styles.css');

const lightBlock = extractBlock(css, /^:root,\s*html\[data-theme="light"\]\s*\{/m) || extractBlock(css, /^:root\s*\{/m);
const darkBlock = extractBlock(css, /html\[data-theme="dark"\]\s*\{/);

check('CSS: light theme token block present', Boolean(lightBlock));
check('CSS: dark theme token block present', Boolean(darkBlock));
check('CSS: color-scheme declared for light', /color-scheme:\s*light/.test(css));
check('CSS: color-scheme declared for dark', /color-scheme:\s*dark/.test(css));

const coreTokens = [
  '--bg', '--panel', '--panel-solid', '--control-bg', '--ink', '--muted', '--line',
  '--accent', '--accent-hover', '--accent-soft', '--header-bg', '--shadow-card',
  '--img-placeholder', '--body-bg', '--hero-bg', '--chevron',
];
const statusTokens = [
  '--upcoming-bg', '--promo-bg', '--preview-bg', '--late-bg', '--preorder-bg',
  '--archived-bg', '--launched-bg', '--soon-bg', '--livechip-bg', '--upchip-bg',
  '--prevchip-bg', '--endchip-bg', '--success-bg', '--error-bg', '--watch-bg',
  '--alert-bg',
];
for (const token of [...coreTokens, ...statusTokens]) {
  const re = new RegExp(`${token}\\s*:`);
  const inLight = lightBlock ? re.test(lightBlock) : false;
  const inDark = darkBlock ? re.test(darkBlock) : false;
  check(`CSS: ${token} defined in light + dark themes`, inLight && inDark);
}

const darkBg = darkBlock ? (darkBlock.match(/--bg:\s*([^;]+);/) || [])[1] : '';
const lightBg = lightBlock ? (lightBlock.match(/--bg:\s*([^;]+);/) || [])[1] : '';
check('CSS: dark --bg differs from light --bg', darkBg && lightBg && darkBg.trim() !== lightBg.trim());

// ── 2. styles.css: family values in, old cardstock values out ───

const familyValues = ['#f4f7fb', '#1769ff', '#090b10', '#6592ff', '0 20px 55px rgba(37, 50, 75, 0.09)'];
for (const value of familyValues) {
  check(`CSS: family value present (${value})`, css.includes(value));
}

const legacyValues = [
  ['#dfd2b2', 'hard offset shadow color'],
  ['#f0ecd9', 'cardstock bg'],
  ['#fff8e8', 'cardstock panel'],
  ['#ccb98f', 'cardstock line'],
  ['#c1440e', 'orange accent'],
  ['#f5efdd', 'cardstock gradient'],
  ['#1f5b72', 'old accent-2'],
  ['#8f3209', 'old hover orange'],
  ['#f0e7ce', 'old hover cream'],
  ['193, 68, 14', 'orange rgba hover'],
  ['Baloo 2', 'Baloo font'],
  ['Source Sans 3', 'Source Sans font'],
  ['Trebuchet MS', 'Trebuchet fallback'],
];
for (const [value, label] of legacyValues) {
  check(`CSS: no legacy ${label}`, !css.includes(value));
}

check('CSS: no render-blocking Google Fonts @import', !/@import\s+url\(['"]https:\/\/fonts\.googleapis\.com/.test(css));
check('CSS: system font stack on body', /body\s*{[^}]*font-family:\s*system-ui/.test(css));

const openBraces = (css.match(/{/g) || []).length;
const closeBraces = (css.match(/}/g) || []).length;
check('CSS: braces balanced', openBraces === closeBraces, `${openBraces} open / ${closeBraces} close`);

check('CSS: theme toggle styles present', /\.theme-toggle\s*\{/.test(css));
check('CSS: sun/moon icon swap for dark theme', /html\[data-theme="dark"\]\s*\.theme-toggle\s*\.sun-icon\s*{[^}]*display:\s*none/.test(css) && /html\[data-theme="dark"\]\s*\.theme-toggle\s*\.moon-icon\s*{[^}]*display:\s*block/.test(css));

// ── 3. HTML pages: no-FOUC bootstrap before stylesheet ─────────

const pages = [
  'index.html', 'live.html', 'upcoming.html', 'preview.html', 'archive.html',
  'watchlist.html', 'submit.html', 'designer.html', 'publisher.html', 'blog/index.html',
];

for (const page of pages) {
  const html = reads(page);
  const scriptIdx = html.indexOf('pnpl_theme_v1');
  const cssIdx = html.search(/<link rel="stylesheet" href="[^"]*styles\.css[^"]*"/);
  check(`HTML ${page}: theme bootstrap present`, scriptIdx !== -1);
  check(`HTML ${page}: bootstrap before stylesheet`, scriptIdx !== -1 && cssIdx !== -1 && scriptIdx < cssIdx);
  check(`HTML ${page}: loads app.js + search.js`, html.includes('app.js') && html.includes('search.js'));
}

// ── 4. app.js: toggle wiring ────────────────────────────────────

const appJs = reads('assets/app.js');

check('JS: header renders theme toggle button', /class="theme-toggle"[^>]*data-theme-toggle/.test(appJs));
check('JS: toggle has sun + moon icons', /class="sun-icon"/.test(appJs) && /class="moon-icon"/.test(appJs));
check('JS: theme storage key pnpl_theme_v1', appJs.includes("'pnpl_theme_v1'"));
check('JS: prefers-color-scheme fallback', appJs.includes('prefers-color-scheme: dark'));
check('JS: click delegation on data-theme-toggle', /closest\('button\[data-theme-toggle\]'\)/.test(appJs));
check('JS: persists choice to localStorage', /localStorage\.setItem\(THEME_STORAGE_KEY/.test(appJs));
check('JS: updates aria-label on toggle', /Switch to light theme/.test(appJs) && /Switch to dark theme/.test(appJs));

// ── 5. Stage 3: header/nav streamlining ───────────────────────

check('JS: no "Submit a Project" nav pill', !appJs.includes("['submit.html', 'Submit a Project']"));
check('JS: no "Watchlist" nav pill', !appJs.includes("['watchlist.html', 'Watchlist']"));
check('JS: Archive nav label', appJs.includes("['archive.html', 'Archive']"));
check('JS: no legacy "Ended" nav label', !appJs.includes("['archive.html', 'Ended']"));
check('JS: header renders primary CTA button', appJs.includes('class="nav-cta"') && appJs.includes("withBase('submit.html')"));
check('JS: watchlist icon button with count badge', appJs.includes('data-watchlist-nav') && appJs.includes('data-watchlist-count'));
check('JS: refreshWatchlistNav keeps badge in sync', appJs.includes('function refreshWatchlistNav') && /refreshWatchlistNav\(\);\n\}/.test(appJs));
check('JS: tools list includes BoardSplitter', appJs.includes('https://boardsplitter.gonzhome.us'));
check('JS: tools list includes TokenMaker', appJs.includes('https://tokenmaker.gonzhome.us'));
check('JS: tools list includes DiceMaker', appJs.includes('https://dicemaker.gonzhome.us'));
check('JS: footer reuses shared tools list', /function footer\(\)[\s\S]{0,200}toolsLinksHtml\(\)/.test(appJs));

check('CSS: nav CTA button styles present', /\.nav-cta\s*{/.test(css) && /\.nav-cta\[aria-current="page"\]/.test(css));
check('CSS: watchlist icon button styles present', /\.watchlist-nav\s*{/.test(css));
check('CSS: watchlist count badge styles present', /\.watchlist-count\s*{/.test(css));

const archiveHtml = reads('archive.html');
check('HTML archive.html: title renamed to Archive', archiveHtml.includes('<title>Archive | PnP Launchpad</title>'));
check('HTML archive.html: header active label is Archive', archiveHtml.includes("PNPL.header('Archive')"));
check('HTML archive.html: no legacy "Ended" header label', !archiveHtml.includes("PNPL.header('Ended')"));

const submitHtml = reads('submit.html');
check('HTML submit.html: CTA button with aria-current', /class="nav-cta"[^>]*aria-current="page"/.test(submitHtml));
check('HTML submit.html: watchlist icon button present', submitHtml.includes('data-watchlist-nav'));
check('HTML submit.html: theme toggle present', submitHtml.includes('data-theme-toggle'));
check('HTML submit.html: renamed Archive link', submitHtml.includes('<a href="archive.html">Archive</a>'));
check('HTML submit.html: no legacy "Ended" nav link', !submitHtml.includes('<a href="archive.html">Ended</a>'));
check('HTML submit.html: tools list includes new tools', submitHtml.includes('boardsplitter.gonzhome.us') && submitHtml.includes('tokenmaker.gonzhome.us') && submitHtml.includes('dicemaker.gonzhome.us'));

// ── Report ──────────────────────────────────────────────────────

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  const mark = r.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${mark}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log('');
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
