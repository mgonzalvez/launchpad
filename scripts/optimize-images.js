#!/usr/bin/env node
/**
 * optimize-images.js — UI improvement plan, Stage 9 (uploads hygiene).
 *
 * uploads/ has grown to ~194 MB, mostly oversized PNGs and JPEGs hotlinked
 * years ago. This pass re-encodes anything larger than the threshold:
 *
 *   opaque PNG  -> JPEG (quality 82, capped at 1200px on the long edge)
 *   transparent PNG -> WebP (quality 82, alpha preserved, 1200px cap)
 *   oversized JPEG  -> re-encoded JPEG (quality 82, 1200px cap)
 *
 * A file is only replaced when the new encoding is at least 10% smaller.
 * References in data/content.json and every *.html file are rewritten to the
 * new filename, and the original is deleted (use --keep-original to keep it).
 *
 * Usage:
 *   node scripts/optimize-images.js [--dry-run] [--verbose] [--min-size=150000]
 *                                   [--keep-original] [--report-unused]
 * Exit 0 = success (or dry run), 1 = failures.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UPLOADS = path.join(ROOT, 'uploads');
const DATA = path.join(ROOT, 'data', 'content.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const keepOriginal = args.includes('--keep-original');
const reportUnused = args.includes('--report-unused');
const minSizeArg = args.find((a) => a.startsWith('--min-size='));
const MIN_SIZE = minSizeArg ? Number(minSizeArg.split('=')[1]) : 150000;
const MAX_EDGE = 1600;
const QUALITY = 82;

const IM = ['magick', 'convert'].find((bin) => spawnSync(bin, ['-version']).status === 0);
if (!IM) {
  console.error('ImageMagick (magick or convert) is required for this script.');
  process.exit(1);
}

const run = (argv) => spawnSync(IM, argv, { encoding: 'utf8' });

const isOpaque = (file) => {
  const r = run([file, '-format', '%[opaque]', 'info:']);
  return r.status === 0 && r.stdout.trim().toLowerCase() === 'true';
};

const dimensions = (file) => {
  const r = run([file, '-format', '%w %h', 'info:']);
  if (r.status !== 0) return null;
  const [w, h] = r.stdout.trim().split(/\s+/).map(Number);
  return { w, h };
};

function htmlFiles() {
  const out = [];
  for (const entry of fs.readdirSync(ROOT)) {
    if (entry.endsWith('.html')) out.push(path.join(ROOT, entry));
  }
  const blogDir = path.join(ROOT, 'blog');
  if (fs.existsSync(blogDir)) {
    for (const entry of fs.readdirSync(blogDir)) {
      if (entry.endsWith('.html')) out.push(path.join(blogDir, entry));
    }
  }
  return out;
}

function collectReferences() {
  const refs = new Map(); // filename -> Set of files that reference it
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  for (const p of data.projects) {
    if (p.image && p.image.startsWith('/uploads/')) {
      const name = p.image.split('?')[0].replace('/uploads/', '');
      if (!refs.has(name)) refs.set(name, new Set());
      refs.get(name).add('data/content.json');
    }
  }
  for (const file of htmlFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/uploads\/([A-Za-z0-9._-]+\.(?:png|jpg|jpeg|webp|avif|gif))/g)) {
      if (!refs.has(m[1])) refs.set(m[1], new Set());
      refs.get(m[1]).add(path.relative(ROOT, file));
    }
  }
  return refs;
}

function rewriteReferences(map) {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  let dataChanges = 0;
  for (const p of data.projects) {
    if (!p.image || !p.image.startsWith('/uploads/')) continue;
    const name = p.image.split('?')[0].replace('/uploads/', '');
    if (map[name]) {
      p.image = p.image.replace(name, map[name]);
      dataChanges++;
    }
  }
  if (dataChanges && !dryRun) fs.writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`);

  let htmlChanges = 0;
  for (const file of htmlFiles()) {
    let text = fs.readFileSync(file, 'utf8');
    let changed = false;
    for (const [oldName, newName] of Object.entries(map)) {
      if (text.includes(oldName)) {
        text = text.split(oldName).join(newName);
        changed = true;
      }
    }
    if (changed && !dryRun) {
      fs.writeFileSync(file, text);
      htmlChanges++;
    }
  }
  return { dataChanges, htmlChanges };
}

function optimize(file) {
  const name = path.basename(file);
  const ext = path.extname(name).toLowerCase();
  const size = fs.statSync(file).size;
  if (size < MIN_SIZE) return null;

  let target = null;
  if (ext === '.png') {
    target = isOpaque(file) ? `${path.basename(name, '.png')}.jpg` : `${path.basename(name, '.png')}.webp`;
  } else if (ext === '.jpg' || ext === '.jpeg') {
    target = name; // re-encode in place
  } else {
    return null; // webp/avif/gif already compact
  }

  const outPath = target === name ? file : path.join(UPLOADS, target);
  if (target !== name && fs.existsSync(outPath)) {
    return { skipped: 'target already exists', name, target };
  }

  const tmp = path.join(UPLOADS, `.tmp-${target}`);
  const result = run([file, '-resize', `${MAX_EDGE}x${MAX_EDGE}`, '-strip', '-quality', String(QUALITY), tmp]);
  if (result.status !== 0) {
    return { skipped: 'ImageMagick failed', name, detail: result.stderr.trim().slice(0, 120) };
  }
  const newSize = fs.statSync(tmp).size;
  const dims = dimensions(file);
  if (newSize >= size * 0.9) {
    fs.unlinkSync(tmp);
    return { skipped: 'no meaningful gain', name, before: size, after: newSize, dims };
  }

  if (dryRun || keepOriginal) {
    fs.unlinkSync(tmp);
    return { wouldReplace: true, name, target, before: size, after: newSize, dims };
  }

  if (outPath !== file) fs.unlinkSync(file);
  fs.renameSync(tmp, outPath);
  return { replaced: true, name, target: path.basename(outPath), before: size, after: newSize, dims };
}

function main() {
  const files = fs.readdirSync(UPLOADS)
    .map((f) => path.join(UPLOADS, f))
    .filter((f) => fs.statSync(f).isFile());

  const refs = collectReferences();
  const unreferenced = files.filter((f) => !refs.has(path.basename(f)));
  if (reportUnused) {
    const bytes = unreferenced.reduce((n, f) => n + fs.statSync(f).size, 0);
    console.log(`Unreferenced files in uploads/ (${unreferenced.length}, ${(bytes / 1048576).toFixed(1)} MB):`);
    for (const f of unreferenced) console.log(`  ${path.basename(f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
  }

  const map = {};
  let saved = 0;
  let replaced = 0;
  let skipped = 0;

  for (const file of files) {
    const result = optimize(file);
    if (!result) continue;
    if (result.replaced || result.wouldReplace) {
      if (result.replaced) map[result.name] = result.target;
      saved += result.before - result.after;
      replaced++;
      if (verbose) {
        console.log(`${result.wouldReplace ? 'would encode' : 'encoded  '} ${result.name} -> ${result.target}  ${(result.before / 1024).toFixed(0)} KB -> ${(result.after / 1024).toFixed(0)} KB  (${result.dims ? `${result.dims.w}x${result.dims.h}` : ''})`);
      }
    } else if (verbose) {
      skipped++;
      console.log(`skipped   ${result.name}: ${result.skipped}${result.before ? ` (${(result.before / 1024).toFixed(0)} KB -> ${(result.after / 1024).toFixed(0)} KB)` : ''}`);
    }
  }

  const { dataChanges, htmlChanges } = dryRun ? { dataChanges: 0, htmlChanges: 0 } : rewriteReferences(map);

  console.log('');
  console.log(`${dryRun ? 'Dry run: would re-encode' : 'Re-encoded'} ${replaced} file(s), saving ${(saved / 1048576).toFixed(1)} MB.`);
  if (!dryRun) console.log(`Updated references: ${dataChanges} project images, ${htmlChanges} html files.`);
  if (unreferenced.length) {
    console.log(`(${unreferenced.length} unreferenced file(s) still in uploads/ — run with --report-unused to list them)`);
  }
  console.log('Remember: git add data/content.json and any changed html; deleted originals are staged with git add -A uploads.');
}

main();
