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

// Extract the body of every block whose selector matches `selectorRe`.
function extractAllBlocks(css, selectorRe) {
  const blocks = [];
  let from = 0;
  while (from < css.length) {
    const start = css.slice(from).search(selectorRe);
    if (start === -1) break;
    const open = css.indexOf('{', from + start);
    if (open === -1) break;
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(css.slice(open + 1, i));
    from = i + 1;
  }
  return blocks;
}

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

// ── 6. Stage 4: home page tightening ──────────────────────────

check('CSS: badge pulses gated behind prefers-reduced-motion: no-preference',
  /@media \(prefers-reduced-motion: no-preference\)/.test(css) &&
  /\.badge\.live-now \{ animation: pulse-live/.test(css) &&
  /\.badge\.preview \{ animation: shimmer-preview/.test(css) &&
  /\.badge\.just-launched \{ animation: pulse-launch/.test(css));
check('CSS: reduced-motion block present', /@media \(prefers-reduced-motion: reduce\)/.test(css));
const gates = extractAllBlocks(css, /@media \(prefers-reduced-motion: no-preference\)/);
const gatedCount = gates.reduce((n, block) => n + (block.match(/animation:/g) || []).length, 0);
const totalAnimations = (css.match(/animation:/g) || []).length;
check('CSS: every animation is gated behind prefers-reduced-motion', gatedCount === totalAnimations, `${gatedCount} gated / ${totalAnimations} total`);
check('CSS: reduced-motion gate covers badge pulses + search overlay', gatedCount >= 7);

const carouselDotBlock = extractBlock(css, /^\.carousel-dots button\s*\{/m);
check('CSS: carousel dots are 44px touch targets',
  carouselDotBlock && /width:\s*44px/.test(carouselDotBlock) && /height:\s*44px/.test(carouselDotBlock));
check('CSS: dot visual drawn by ::after pseudo-element', /\.carousel-dots button::after\s*\{/.test(css));
const carouselControlBlock = extractBlock(css, /^\.carousel-controls button\s*\{/m);
check('CSS: carousel arrows are 44px touch targets',
  carouselControlBlock && /width:\s*44px/.test(carouselControlBlock) && /height:\s*44px/.test(carouselControlBlock));
const tileHandleBlock = extractBlock(css, /^\.tile-handle\s*\{/m);
check('CSS: live-strip handles are 44px touch targets',
  tileHandleBlock && /width:\s*44px/.test(tileHandleBlock) && /height:\s*44px/.test(tileHandleBlock));

const homeRowBlock = extractBlock(css, /^\.home-compact-row\s*\{/m);
check('CSS: home compact rows wrap instead of hidden scrolling',
  homeRowBlock && !/overflow-x:\s*auto/.test(homeRowBlock) && /grid-template-columns:\s*repeat\(auto-fit/.test(homeRowBlock));
check('CSS: no hidden-scrollbar rule for home compact rows', !/\.home-compact-row::-webkit-scrollbar/.test(css));

const indexHtml = reads('index.html');
check('HTML index.html: hero trimmed to a single sentence',
  !indexHtml.includes('Welcome to PnP Launchpad, your connection to') &&
  /<p>Hand-picked print-and-play crowdfunding/.test(indexHtml));
check('HTML index.html: carousel has aria-roledescription + label',
  /aria-roledescription="carousel"/.test(indexHtml) && /aria-label="Featured live projects"/.test(indexHtml));
check('HTML index.html: polite carousel live region',
  /class="carousel-live"[^>]*aria-live="polite"/.test(indexHtml) && /id="carousel-live"/.test(indexHtml));
check('JS index.html: carousel pauses on hover', /addEventListener\('mouseenter', stop\)/.test(indexHtml));
check('JS index.html: carousel pauses on focus', /addEventListener\('focusin', stop\)/.test(indexHtml));
check('JS index.html: reduced-motion respected', /prefers-reduced-motion: reduce/.test(indexHtml) && /if \(reducedMotion\) return;/.test(indexHtml) && /scrollBehavior/.test(indexHtml));
check('JS index.html: inactive slides made inert', /s\.inert = i !== current/.test(indexHtml));

// ── 7. Stage 6: search accessibility + touch targets ──────────

const searchJs = reads('assets/search.js');
check('JS search: focus trap while the panel is open', /if \(e\.key !== 'Tab' \|\| !searchState\.open\) return;/.test(searchJs));
check('JS search: focus returns to the trigger on close', /searchBtn\.focus\(\);/.test(searchJs));
check('JS search: trigger aria-expanded kept in sync',
  searchJs.includes("setAttribute('aria-expanded', 'true')") && searchJs.includes("setAttribute('aria-expanded', 'false')"));
check('JS search: search trigger has aria-haspopup dialog', searchJs.includes("setAttribute('aria-haspopup', 'dialog')"));
check('JS search: panel marked as a labelled dialog', searchJs.includes("setAttribute('role', 'dialog')") && searchJs.includes("setAttribute('aria-label', 'Site search')"));
check('JS search: result rows are real links (keyboard reachable)',
  /<a class="search-result-item search-result-project" href=/.test(searchJs) &&
  /<a class="search-result-item search-result-person" href=/.test(searchJs));
check('JS search: polite status region announces result counts',
  /aria-live="polite"/.test(searchJs) && /function updateSearchStatus\(\)/.test(searchJs));
const searchCloseBlock = extractBlock(css, /^\.search-close\s*\{/m);
check('CSS: search close button is a 44px touch target',
  searchCloseBlock && /width:\s*44px/.test(searchCloseBlock) && /height:\s*44px/.test(searchCloseBlock));
const searchCountBlock = extractBlock(css, /^\.search-count\s*\{/m);
check('CSS: search result count is not drawn with a border color',
  searchCountBlock && !/color:\s*var\(--line\)/.test(searchCountBlock));

// ── 8. Stage 7: SEO / meta coverage ───────────────────────────

const blogPosts = fs.readdirSync(path.join(ROOT, 'blog')).filter((f) => f.endsWith('.html')).map((f) => `blog/${f}`);
for (const page of new Set([...pages, ...blogPosts])) {
  const html = reads(page);
  check(`HTML ${page}: meta description`, /<meta name="description" content="[^"]{20,}"/.test(html));
  check(`HTML ${page}: Open Graph title + description`, html.includes('og:title') && html.includes('og:description') && html.includes('og:image'));
  check(`HTML ${page}: canonical URL`, /<link rel="canonical" href="https:\/\/launchpad\.gonzhome\.us\//.test(html));
  check(`HTML ${page}: theme-color for both themes`,
    /theme-color" content="#f4f7fb"/.test(html) && /theme-color" content="#090b10"/.test(html));
}

// ── 9. Stage 8: determinism + archive pagination ──────────────

check('JS: seeded PRNG helpers present',
  /function mulberry32\(seed\)/.test(appJs) &&
  /function seededShuffle\(items, seed\)/.test(appJs) &&
  /function daySeed\(now = new Date\(\)\)/.test(appJs));
check('JS: determinism helpers exported', appJs.includes('  daySeed,') && appJs.includes('  seededShuffle,') && appJs.includes('  mulberry32,'));
check('JS index.html: carousel uses the day seed, not Math.random',
  /PNPL\.seededShuffle\(pool, featuredSeed\)/.test(indexHtml) &&
  !/\.map\(\(p\) => \[Math\.random\(\), p\]\)/.test(indexHtml));
check('HTML index.html: carousel carries its seed for debugging', indexHtml.includes('data-seed="${featuredSeed}"'));

const archivePage = reads('archive.html');
check('HTML archive.html: polite "showing n of m" status', /class="archive-status"[^>]*aria-live="polite"/.test(archivePage));
check('HTML archive.html: back-to-top control', /id="back-to-top" class="back-to-top"/.test(archivePage));
check('HTML archive.html: sort/view re-render without a page reload',
  !/window\.location\.reload\(\)/.test(archivePage) && /function renderArchive\(\)/.test(archivePage));
check('HTML archive.html: back-to-top respects reduced motion', /reducedMotion \? 'auto' : 'smooth'/.test(archiveHtml));
check('CSS: archive status + back-to-top styles present', /\.archive-status\s*\{/.test(css) && /\.back-to-top\s*\{/.test(css));

// ── 10. Stage 9: uploads size discipline ────────────────

check('script: optimize-images.js exists', fs.existsSync(path.join(ROOT, 'scripts', 'optimize-images.js')));
const dataJson = JSON.parse(reads('data/content.json'));
let biggest = 0;
let biggestName = '';
let missing = 0;
for (const p of dataJson.projects) {
  if (!p.image || !p.image.startsWith('/uploads/')) continue;
  const file = path.join(ROOT, 'uploads', p.image.split('?')[0].replace('/uploads/', ''));
  if (!fs.existsSync(file)) { missing++; continue; }
  const size = fs.statSync(file).size;
  if (size > biggest) { biggest = size; biggestName = p.image; }
}
check('data: every local project image exists', missing === 0, `${missing} missing`);
check('data: every local project image is under 900 KB', biggest <= 900 * 1024, `${biggestName} is ${(biggest / 1024).toFixed(0)} KB`);

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
