#!/usr/bin/env node
/**
 * contrast-check.js — UI improvement plan, Stage 6 (accessibility).
 *
 * Computes WCAG 1.1 contrast ratios for the token pairs that actually
 * appear as text-on-surface in both themes. Semi-transparent surfaces are
 * composited over the page background before the ratio is measured.
 *
 * Usage: node scripts/contrast-check.js [--verbose]
 * Exit 0 = all pairs >= 4.5 (AA for normal text); 1 = failures.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'assets', 'styles.css'), 'utf8');
const verbose = process.argv.includes('--verbose');

function blockBody(selectorRe) {
  const start = css.search(selectorRe);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
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

const lightBody = blockBody(/^:root,\s*html\[data-theme="light"\]\s*\{/m);
const darkBody = blockBody(/html\[data-theme="dark"\]\s*\{/);

function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1].replace(/^--/, '')] = m[2].trim();
  }
  return out;
}

function parseColor(value) {
  if (!value) return null;
  const v = value.trim();
  const hex = v.match(/#([0-9a-f]{3,6})\b/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = v.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => parseFloat(p.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}

// Composite a (possibly translucent) surface over its parent, recursively.
function resolve(tokens, name, seen = new Set()) {
  const raw = tokens[name];
  if (!raw) return null;
  const color = parseColor(raw); // gradients: first colour stop wins
  if (!color) return null;
  if (color.a >= 1 || name === 'bg' || seen.has(name)) return color;
  seen.add(name);
  const parentName = name.startsWith('panel') || name.startsWith('control') || name.startsWith('header') ? 'bg' : 'panel';
  const parent = resolve(tokens, parentName, seen);
  if (!parent) return color;
  return blend(color, parent);
}

function blend(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function luminance(c) {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

function ratio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / Math.min(l1, l2) + 0;
}

const statusPairs = [
  ['upcoming', 'upcoming-ink', 'upcoming-bg'],
  ['promo', 'promo-ink', 'promo-bg'],
  ['preview', 'preview-ink', 'preview-bg'],
  ['late-pledge', 'late-ink', 'late-bg'],
  ['pre-order', 'preorder-ink', 'preorder-bg'],
  ['archived', 'archived-ink', 'archived-bg'],
  ['just-launched', 'launched-ink', 'launched-bg'],
  ['ending-soon', 'soon-ink', 'soon-bg'],
  ['live chip', 'livechip-ink', 'livechip-bg'],
  ['upcoming chip', 'upchip-ink', 'upchip-bg'],
  ['preview chip', 'prevchip-ink', 'prevchip-bg'],
  ['end chip', 'endchip-ink', 'endchip-bg'],
  ['watch button', 'watch-ink', 'watch-bg'],
  ['watch active', 'watch-active-ink', 'watch-active-bg'],
  ['launch alert', 'alert-ink', 'alert-bg'],
  ['alert sub', 'alert-sub', 'alert-bg'],
  ['success notice', 'ink', 'success-bg'],
  ['error notice', 'error-ink', 'error-bg'],
  ['ok badge', 'okbadge-ink', 'okbadge-bg'],
  ['warn badge', 'warnbadge-ink', 'warnbadge-bg'],
  ['neutral badge', 'neutbadge-ink', 'neutbadge-bg'],
];

const generalPairs = [
  ['body ink on page', 'ink', 'bg'],
  ['muted text on page', 'muted', 'bg'],
  ['muted text on panel', 'muted', 'panel'],
  ['ink on panel', 'ink', 'panel'],
  ['link accent on panel', 'accent', 'panel'],
  ['secondary ink on panel', 'ink-secondary', 'panel'],
  ['nav current text on nav highlight', 'accent', 'nav-current-bg'],
];

let failures = 0;
const rows = [];

for (const [themeName, body] of [['light', lightBody], ['dark', darkBody]]) {
  if (!body) {
    console.error(`FAIL  could not find the ${themeName} token block`);
    failures++;
    continue;
  }
  const t = tokens(body);
  for (const [label, inkToken, surfaceToken] of [...generalPairs, ...statusPairs]) {
    const ink = resolve(t, inkToken);
    const surface = resolve(t, surfaceToken);
    if (!ink || !surface) {
      rows.push({ theme: themeName, label, ratio: null, note: 'unresolvable color' });
      failures++;
      continue;
    }
    const r = ratio(ink, surface);
    rows.push({ theme: themeName, label, ratio: r, pass: r >= 4.5 });
    if (r < 4.5) failures++;
  }
}

for (const row of rows) {
  if (row.ratio === null) {
    console.log(`?      ${row.theme}  ${row.label} — ${row.note}`);
    continue;
  }
  const mark = row.pass ? '\x1b[32mAA\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m';
  if (verbose || !row.pass) {
    console.log(`${mark}  ${row.theme}  ${row.label} — ${row.ratio.toFixed(2)}:1`);
  }
}

console.log('');
console.log(failures ? `\x1b[31m${failures} contrast pair(s) below 4.5:1\x1b[0m` : '\x1b[32mall text/surface pairs meet AA (4.5:1)\x1b[0m');
process.exit(failures ? 1 : 0);
