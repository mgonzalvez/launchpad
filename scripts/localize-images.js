#!/usr/bin/env node
/**
 * localize-images.js — UI improvement plan, Stage 5 (image robustness).
 *
 * content.json hotlinks signed `i.kickstarter.com` URLs (`sig=`/`v=` params)
 * that expire, producing 404s on the live site over time. This script
 * downloads the image for every non-archived project into uploads/ and
 * rewrites the project's `image` field to the local path.
 *
 * Usage:
 *   node scripts/localize-images.js [--dry-run] [--all] [--concurrency=6] [--verbose]
 *
 * Exit 0 = every active project is local (or the run was a dry run with no
 * hard failures); 1 = at least one download failed.
 *
 * SOP: downloaded files must be `git add`'d in the same commit as
 * data/content.json, or they will 404 on GitHub Pages.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'content.json');
const UPLOADS = path.join(ROOT, 'uploads');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const includeArchived = args.includes('--all');
const verbose = args.includes('--verbose');
const concArg = args.find((a) => a.startsWith('--concurrency='));
const concurrency = Math.max(1, Number(concArg ? concArg.split('=')[1] : 6) || 6);

// ── Status computation (mirrors assets/app.js projectStatus) ─────

const hasIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const parseTime = (t) => (/^\d{2}:\d{2}$/.test(String(t || '')) ? String(t).split(':') : null);
const parseDateTime = (date, time, kind) => {
  const parts = parseTime(time);
  if (!hasIsoDate(date)) return null;
  const hh = parts ? parts[0] : kind === 'start' ? '00' : '23';
  const mm = parts ? parts[1] : kind === 'start' ? '00' : '59';
  return new Date(`${date}T${hh}:${mm}:${kind === 'start' ? '00' : '59'}`);
};
const addHours = (d, h) => new Date(d.getTime() + h * 3600 * 1000);

function projectStatus(p, now = new Date()) {
  if (p.isPreview || (!hasIsoDate(p.launchDate) && !hasIsoDate(p.endDate))) return 'preview';
  if (p.isArchived) return 'archived';
  const launch = parseDateTime(p.launchDate, p.launchTime, 'start') || now;
  const end = addHours(parseDateTime(p.endDate, p.endTime, 'end') || now, 24);
  if (launch > now) return 'upcoming';
  if (end < now) {
    if (p.isLatePledge || p.hasLatePledge || p.latePledgeUrl) return 'late-pledge';
    if (p.isPreOrder || p.hasPreOrder || p.preOrderUrl) return 'pre-order';
    return 'archived';
  }
  return p.isPromo ? 'promo' : 'live';
}

// ── Helpers ──────────────────────────────────────────────────────

const EXT_SAFE = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']);

function targetFilename(project, url) {
  const slug = String(project.slug || project.title || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
  const pathPart = url.split('?')[0];
  let ext = (pathPart.split('.').pop() || 'jpg').toLowerCase();
  if (!EXT_SAFE.has(ext)) ext = 'jpg';
  if (ext === 'jpeg') ext = 'jpg';
  return `${slug}.${ext}`;
}

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PnP-Launchpad/1.0 (image localization script)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`not an image (${type})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800) throw new Error(`image too small (${buf.length} bytes)`);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const now = new Date();

  const candidates = data.projects.filter((p) => {
    if (!/^https?:\/\//.test(p.image || '')) return false;
    if (!includeArchived && projectStatus(p, now) === 'archived') return false;
    return true;
  });

  console.log(`Active projects with remote images: ${candidates.length}`);

  const byUrl = new Map();
  for (const p of candidates) {
    const url = p.image;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(p);
  }

  const queue = [...byUrl.entries()];
  let done = 0;
  let failed = 0;
  let reused = 0;
  const failures = [];

  const worker = async () => {
    while (queue.length) {
      const [url, projects] = queue.shift();
      const name = targetFilename(projects[0], url);
      const dest = path.join(UPLOADS, name);
      if (fs.existsSync(dest)) {
        reused++;
        if (!dryRun) projects.forEach((p) => { p.image = `/uploads/${name}`; });
        if (verbose) console.log(`exists   ${name}  (${projects.length} project(s))`);
        done++;
        continue;
      }
      if (dryRun) {
        console.log(`would fetch ${url.slice(0, 78)}...  ->  uploads/${name}`);
        done++;
        continue;
      }
      try {
        const bytes = await download(url, dest);
        projects.forEach((p) => { p.image = `/uploads/${name}`; });
        console.log(`saved    ${name}  (${(bytes / 1024).toFixed(0)} KB)  <- ${projects.map((p) => p.slug).join(', ')}`);
        done++;
      } catch (err) {
        failed++;
        failures.push({ slug: projects[0].slug, url, error: err.message });
        console.log(`FAILED   ${projects[0].slug}: ${err.message}`);
        done++;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  if (!dryRun) {
    fs.writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`);
    console.log('');
    console.log(`Localized ${done - failed} image(s); ${reused} already present; ${failed} failed.`);
    if (failed) {
      for (const f of failures) console.log(`  keep remote: ${f.slug} (${f.error})`);
    }
    console.log('Remember: git add uploads/ alongside data/content.json before committing.');
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`localize-images failed: ${err.message}`);
  process.exit(1);
});
