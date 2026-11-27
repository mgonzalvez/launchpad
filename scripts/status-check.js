#!/usr/bin/env node
'use strict';
/**
 * status-check.js — audit what the site claims against what the campaign
 * pages actually say, and (with --fix) correct data/content.json.
 *
 * For every project currently in `live`, `upcoming` or `preview` status the
 * script resolves the real campaign state, compares it with the status the
 * site computes from launchDate/endDate, and reports (optionally applies)
 * the smallest accurate correction.
 *
 * Sources, in order of what actually works from this machine:
 *   1. Kicktraq  — Kickstarter campaigns. No bot challenge, gives exact
 *      launch/end datetimes, funding state, backers, days left.
 *   2. Direct fetch of the campaign page (Gamefound, Backerkit, itch.io,
 *      stores) — works when the host isn't Cloudflare-challenged.
 *   3. Wayback Machine snapshot of the campaign page.
 *
 * Everything is cached under .cache/status-check/ with a TTL, so repeated
 * runs are fast and polite. Requests run in parallel (default 8 at a time).
 *
 * Usage:
 *   node scripts/status-check.js                         # dry run, report only
 *   node scripts/status-check.js --fix                   # apply corrections
 *   node scripts/status-check.js --status=live,upcoming,preview
 *   node scripts/status-check.js --all                   # include archived/late-pledge
 *   node scripts/status-check.js --project=case-blue-a-ww2-roll-and-write-game
 *   node scripts/status-check.js --limit=20 --verbose --out data/status-report.json
 *   node scripts/status-check.js --no-cache --concurrency=8 --timeout=15
 *
 * Exit codes: 0 = no deviations found; 1 = deviations found (dry run) or
 * fatal error. With --fix, deviations were applied so exit is 0.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Configuration / CLI ────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'status-check');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name) || argv.some((a) => a.startsWith(name + '='));
const opt = (name, def) => {
  const hit = argv.find((a) => a.startsWith(name + '='));
  if (hit) return hit.split('=')[1];
  const bare = argv.find((a) => a === name);
  return bare !== undefined && argv[argv.indexOf(name) + 1] && !argv[argv.indexOf(name) + 1].startsWith('--')
    ? argv[argv.indexOf(name) + 1]
    : def;
};

const FIX = flag('--fix');
const VERBOSE = flag('--verbose');
const NO_CACHE = flag('--no-cache');
const QUIET = flag('--quiet');
const CONCURRENCY = Math.max(1, Number(opt('--concurrency', 8)));
const TIMEOUT = Math.max(5000, Number(opt('--timeout', 25)) * 1000);
const CACHE_TTL = Math.max(0, Number(opt('--cache-ttl', 6)) * 3600 * 1000); // hours
const DATE_TOLERANCE = Number(opt('--date-tolerance', 1)); // days of drift we tolerate
const MIN_CONFIDENCE = (opt('--min-confidence', 'medium') || 'medium').toLowerCase();
const STATUS_FILTER = (opt('--status', opt('--statuses', 'live,upcoming,preview')) || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ALL_STATUSES = flag('--all');
const PLATFORM_FILTER = opt('--platform', null);
const PROJECT_FILTER = opt('--project', null);
const LIMIT = Number(opt('--limit', 0)) || 0;
const OUT_FILE = opt('--out', null);
const DATA_FILE = path.resolve(opt('--data', path.join(ROOT, 'data/content.json')));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ── Small helpers ──────────────────────────────────────────────────────────────
const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m' };
function log(msg, color = '') {
  if (QUIET && !['red', 'yellow', 'green', 'bold'].includes(color)) return;
  process.stdout.write((C[color] || '') + msg + C.reset + '\n');
}

function ymd(d) {
  // Local calendar date, zero-padded.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hasIsoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isValidDate(v) {
  if (!hasIsoDate(v)) return false;
  const mo = Number(v.slice(5, 7));
  const day = Number(v.slice(8, 10));
  return mo >= 1 && mo <= 12 && day >= 1 && day <= 31;
}

function parseTimeParts(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

// Mirrors assets/app.js so the script's idea of "status" is the site's idea.
function parseProjectDateTime(dateValue, timeValue, fallback = 'midday') {
  if (!hasIsoDate(dateValue)) return new Date(dateValue);
  const m = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parts = parseTimeParts(timeValue);
  let hours = 12;
  let minutes = 0;
  if (parts) {
    hours = parts.hours;
    minutes = parts.minutes;
  } else if (fallback === 'start') {
    hours = 0;
    minutes = 0;
  } else if (fallback === 'end') {
    hours = 23;
    minutes = 59;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hours, minutes, 0, 0);
}

function addHours(d, h) {
  return new Date(d.getTime() + h * 3600000);
}

function siteStatus(p, now = new Date()) {
  const isPreview = Boolean(p.isPreview) || (!hasIsoDate(p.launchDate) && !hasIsoDate(p.endDate));
  if (isPreview) return 'preview';
  if (p.isArchived) return 'archived';
  const launch = parseProjectDateTime(p.launchDate, p.launchTime, 'start');
  const end = addHours(parseProjectDateTime(p.endDate, p.endTime, 'end'), 24); // 24h timezone grace
  const hasLatePledge = Boolean(p.isLatePledge || p.hasLatePledge || p.latePledgeUrl);
  const hasPreOrder = Boolean(p.isPreOrder || p.hasPreOrder || p.preOrderUrl);
  if (launch > now) return 'upcoming';
  if (end < now) {
    if (hasLatePledge) return 'late-pledge';
    if (hasPreOrder) return 'pre-order';
    return 'archived';
  }
  if (p.isPromo) return 'promo';
  return 'live';
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

const CONF_SCORE = { high: 3, medium: 2, low: 1, none: 0 };
const confScore = (c) => CONF_SCORE[c] ?? 0;

// ── HTTP + cache ───────────────────────────────────────────────────────────────
function cacheKey(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

function cacheRead(url) {
  if (NO_CACHE) return null;
  const f = path.join(CACHE_DIR, cacheKey(url));
  if (!fs.existsSync(f)) return null;
  if (Date.now() - fs.statSync(f).mtimeMs > CACHE_TTL) return null;
  try {
    const hit = JSON.parse(fs.readFileSync(f, 'utf8'));
    hit.ok = hit.status >= 200 && hit.status < 300;
    return hit;
  } catch {
    return null;
  }
}

function cacheWrite(url, entry) {
  if (NO_CACHE) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, cacheKey(url)), JSON.stringify(entry));
}

async function httpGet(url, timeout = TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/json,*/*;q=0.8' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: e.message };
  } finally {
    clearTimeout(t);
  }
}

function isBlocked(body) {
  return /Just a moment|cf-chl|Challenge Captcha|Attention Required|Enable JavaScript and cookies/i.test(body.slice(0, 4000));
}

// Be polite per host: Kicktraq and archive.org are the two we hammer.
const MIN_INTERVAL = { 'www.kicktraq.com': 200, 'archive.org': 250, 'web.archive.org': 250 };
const hostNext = new Map();
async function throttle(url) {
  const host = new URL(url).host;
  const min = MIN_INTERVAL[host] ?? 120;
  const now = Date.now();
  const start = Math.max(now, hostNext.get(host) || 0);
  hostNext.set(host, start + min);
  if (start > now) await new Promise((r) => setTimeout(r, start - now));
}

// Cached fetch: stores {status, body} so a rerun is instant.
async function fetchCached(url, label) {
  const hit = cacheRead(url);
  if (hit) return { ...hit, cached: true };
  await throttle(url);
  let r = await httpGet(url);
  // Kicktraq and archive.org both stall now and then; two quick retries
  // prevent a transient timeout from being reported as "unverified".
  for (let attempt = 0; attempt < 2 && (!r.ok || isBlocked(r.body)) && r.status !== 404; attempt++) {
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    r = await httpGet(url);
  }
  if (r.ok && !isBlocked(r.body)) cacheWrite(url, { status: r.status, body: r.body, fetchedAt: Date.now(), label });
  return { ok: r.ok, status: r.status, body: r.body, cached: false, error: r.error };
}

// ── Parsers ────────────────────────────────────────────────────────────────────
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function humanDateToIso(text) {
  if (!text) return null;
  const m = String(text).match(/(\d{1,2})(?:st|nd|rd|th)?\s+of\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  const m2 = String(text).match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m2) {
    const mo = MONTHS[m2[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m2[3]}-${String(mo).padStart(2, '0')}-${String(m2[2]).padStart(2, '0')}`;
  }
  return null;
}

// Campaign deadlines are timestamps. The site stores calendar dates, so convert
// to US Pacific — Kickstarter closes at 11:59pm Pacific and that is the date
// the countdown on the site should show.
function toSiteDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const m = parts.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); // dd/mm/yyyy
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  } catch {
    /* fall through */
  }
  return raw.slice(0, 10);
}

function jsonValue(raw) {
  if (!raw) return null;
  const v = String(raw).trim();
  return v === 'null' || v === '' ? null : v;
}

function kicktraqUrl(url) {
  const m = String(url).match(/kickstarter\.com\/projects\/([^?#]+?)(?:\/?)(?:\?.*)?$/i);
  if (!m) return null;
  return `https://www.kicktraq.com/projects/${m[1].replace(/\/$/, '')}/`;
}

function parseKicktraq(html) {
  const ribbon = (html.match(/class="ribbon-inner[^"]*"><h3>([^<]+)<\/h3>/i) || [])[1] || '';
  const datelinks = [...html.matchAll(/class="datelink"\s+title="([^"]+)"/g)].map((m) => m[1]);
  const clockDays = (html.match(/id="clock-days">(\d+)/) || [])[1];
  const clockHours = (html.match(/id="clock-hours">(\d+)/) || [])[1];
  const fundLine = (html.match(/Funding:\s*([^<]+)<br/i) || html.match(/Funded:\s*([^<]+)<br/i) || [])[1] || '';
  const backers = (html.match(/Backers:\s*([\d,]+)/i) || [])[1] || '';
  const isPlaceholder = /New Project Found!|You've gone and found us a gem/i.test(html);

  const launchDate = datelinks.length ? humanDateToIso(datelinks[0]) : null;
  const endDate = datelinks.length > 1 ? humanDateToIso(datelinks[1]) : null;

  const now = new Date();
  let state = 'unknown';
  if (/Funding Successful|Funding Failed/i.test(ribbon)) state = 'ended';
  else if (/Status:\s*Active/i.test(ribbon)) state = 'active';
  else if (endDate && new Date(endDate + 'T23:59:59') < now) state = 'ended';
  else if (endDate && launchDate && new Date(launchDate) <= now) state = 'active';
  else if (launchDate && new Date(launchDate) > now) state = 'upcoming';
  else if (isPlaceholder) state = 'unknown';

  return {
    source: 'kicktraq',
    confidence: 'high',
    state,
    launchDate,
    endDate,
    daysLeft: clockDays ? Number(clockDays) : null,
    backers: backers || null,
    funding: fundLine.trim() || null,
    note: ribbon || (isPlaceholder ? 'not tracked by Kicktraq' : ''),
  };
}

function parseGeneric(html, url) {
  const now = new Date();
  const out = { source: null, confidence: 'low', state: 'unknown', launchDate: null, endDate: null, backers: null, note: '' };

  // Kickstarter inline JSON (first match is the campaign itself)
  const ksDeadline = (html.match(/"project_deadline"\s*:\s*"([^"]+)"/i) || html.match(/"deadline"\s*:\s*"([^"]+)"/i) || [])[1];
  const ksLaunched = (html.match(/"project_launched_at"\s*:\s*"([^"]+)"/i) || html.match(/"launched_at"\s*:\s*"([^"]+)"/i) || [])[1];
  const ksState = (html.match(/"state"\s*:\s*"([^"]+)"/i) || [])[1];

  // Gamefound inline JSON. The campaign record is the object that carries
  // "campaignEndScheduledAt" — anchor there so advert banners for *other*
  // projects can't poison the dates.
  const gfAnchor = html.indexOf('"campaignEndScheduledAt"');
  const gfBlock = gfAnchor >= 0 ? html.slice(Math.max(0, gfAnchor - 300), gfAnchor + 400) : '';
  const gfEnd = jsonValue((gfBlock.match(/"campaignEnd"\s*:\s*"?([^",}]+)"?/i) || [])[1]);
  const gfStart = jsonValue((gfBlock.match(/"campaignStart"\s*:\s*"?([^",}]+)"?/i) || [])[1]);
  const gfBackers = Number((gfBlock.match(/"backersCount":(\d+)/i) || [])[1] || 0);

  if (/kickstarter\.com/i.test(url) && (ksDeadline || ksLaunched || ksState)) {
    out.source = 'kickstarter page';
    out.confidence = 'medium';
    out.endDate = toSiteDate(ksDeadline);
    out.launchDate = toSiteDate(ksLaunched);
    if (ksState === 'successful' || ksState === 'ended' || ksState === 'failed') out.state = 'ended';
    if (ksState === 'live') out.state = 'active';
    out.note = ksState ? `state=${ksState}` : out.note;
  }
  if (/gamefound\.com/i.test(url) && (gfEnd || gfStart)) {
    out.source = out.source || 'gamefound page';
    out.confidence = 'medium';
    out.endDate = toSiteDate(gfEnd);
    out.launchDate = toSiteDate(gfStart);
    out.backers = gfBackers || null;
    if (!gfStart) out.state = 'unlaunched';
    else if (out.endDate && new Date(out.endDate + 'T23:59:59') < now) out.state = 'ended';
    else out.state = 'active';
    out.note = `backers=${gfBackers}`;
  }

  // Human-readable fallbacks
  if (!out.endDate) {
    const m = html.match(/(?:Campaign ends|Ends|Deadline|Funding ends)[:\s]+([A-Za-z]+ \d{1,2},? \d{4})/i);
    if (m) { out.endDate = humanDateToIso(m[1]); out.source = out.source || 'page text'; }
  }
  if (!out.launchDate) {
    const m = html.match(/(?:Campaign launched|Launched|Started|Campaign starts|Starts)[:\s]+([A-Za-z]+ \d{1,2},? \d{4})/i);
    if (m) { out.launchDate = humanDateToIso(m[1]); out.source = out.source || 'page text'; }
  }
  if (/This campaign has ended|Campaign ended|funding period ended/i.test(html) && !out.endDate) {
    out.state = 'ended';
    out.note = (out.note + ' ended').trim();
  }
  if (out.state === 'unknown') {
    if (out.endDate && new Date(out.endDate + 'T23:59:59') < now) out.state = 'ended';
    else if (out.launchDate && new Date(out.launchDate) <= now) out.state = 'active';
    else if (out.launchDate) out.state = 'upcoming';
    else if (/coming soon|pre-launch|not yet launched/i.test(html)) out.state = 'unlaunched';
  }
  return out;
}

function waybackSnapshotUrl(url) {
  return `http://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
}

// Pages the human has already saved for scraping (upstream/, new/) are the
// fastest possible source: no network, and the campaign page is right there.
let localPages = null;
function loadLocalPages() {
  if (localPages) return localPages;
  localPages = new Map();
  for (const dir of ['upstream', 'new']) {
    const d = path.join(ROOT, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/\.html?$/i.test(f)) continue;
      const file = path.join(d, f);
      if (Date.now() - fs.statSync(file).mtimeMs > 90 * 86400000) continue; // ignore ancient saves
      const body = fs.readFileSync(file, 'utf8');
      const canon = (body.match(/property="og:url" content="([^"]+)"/i) || body.match(/rel="canonical" href="([^"]+)"/i) || [])[1];
      if (canon) localPages.set(canon.replace(/[/?#].*$/, '').replace(/\/$/, ''), { file, body });
    }
  }
  return localPages;
}

function localEvidence(project) {
  const key = String(project.primaryUrl || '').replace(/[/?#].*$/, '').replace(/\/$/, '');
  const hit = loadLocalPages().get(key);
  if (!hit) return null;
  const parsed = parseGeneric(hit.body, project.primaryUrl);
  if (parsed.state === 'unknown') return null;
  parsed.source = `saved page (${path.basename(hit.file)})`;
  parsed.confidence = 'high';
  return parsed;
}

async function tryWayback(url) {
  let snap = null;
  const avail = await fetchCached(waybackSnapshotUrl(url), 'wayback availability');
  if (avail.ok) {
    try {
      snap = JSON.parse(avail.body).archived_snapshots?.closest;
    } catch {
      snap = null;
    }
  }
  if (!snap || !snap.url) {
    // The availability API is flaky; the CDX index is the authoritative list.
    const cdx = await fetchCached(
      `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&filter=statuscode:200&collapse=urlkey&limit=1&fl=timestamp,original&from=${ymd(new Date(Date.now() - 30 * 86400000))}`,
      'wayback cdx'
    );
    if (cdx.ok) {
      try {
        const rows = JSON.parse(cdx.body);
        if (rows.length > 1) snap = { url: rows[1][1], timestamp: rows[1][0] };
      } catch {
        snap = null;
      }
    }
  }
  if (!snap || !snap.url) return null;
  const ageDays = (Date.now() - new Date(snap.timestamp).getTime()) / 86400000;
  if (ageDays > 30) return null; // too stale to trust for live status
  const page = await fetchCached(snap.url.replace(/id_$/, 'id_'), 'wayback snapshot');
  if (!page.ok) return null;
  const parsed = parseGeneric(page.body, url);
  parsed.source = `wayback (${snap.timestamp})`;
  parsed.confidence = 'medium';
  return parsed;
}

// ── Resolution chain per project ───────────────────────────────────────────────
async function resolveProject(project) {
  const url = project.primaryUrl || '';
  if (!url || /^(https:\/\/)?(www\.)?(bgg|boardgamegeek)\.com/i.test(url)) {
    return { state: 'unknown', confidence: 'none', note: 'no campaign URL to check' };
  }

  if (project.isPromo || project.platform === 'Promo') {
    return { state: 'unknown', confidence: 'none', note: 'promo listing — no campaign to verify' };
  }

  const chain = [];
  const local = localEvidence(project);
  if (local) return local;
  if (/kickstarter\.com/i.test(url)) {
    const k = kicktraqUrl(url);
    if (k) chain.push({ label: 'kicktraq', url: k, parse: parseKicktraq });
    chain.push({ label: 'wayback', url, parse: null, wayback: true });
  } else {
    chain.push({ label: 'direct', url, parse: (h) => parseGeneric(h, url) });
    chain.push({ label: 'wayback', url, parse: null, wayback: true });
  }

  for (const step of chain) {
    let evidence = null;
    try {
      if (step.wayback) {
        evidence = await tryWayback(url);
      } else {
        const res = await fetchCached(step.url, step.label);
        if (!res.ok || isBlocked(res.body)) {
          if (VERBOSE) log(`    · ${step.label} unavailable (${res.status || 'blocked'})`, 'dim');
          continue;
        }
        evidence = step.parse(res.body);
        if (evidence.state === 'unknown' && !evidence.endDate && !evidence.launchDate) {
          if (VERBOSE) log(`    · ${step.label} gave no status`, 'dim');
          continue;
        }
      }
    } catch (e) {
      if (VERBOSE) log(`    · ${step.label} error: ${e.message}`, 'dim');
      continue;
    }
    if (evidence && evidence.state !== 'unknown') return evidence;
    if (evidence && VERBOSE) log(`    · ${step.label}: inconclusive`, 'dim');
  }
  return { state: 'unknown', confidence: 'none', note: 'no reachable source' };
}

// ── Diff engine ────────────────────────────────────────────────────────────────
function audit(project, evidence, now) {
  const status = siteStatus(project, now);
  const changes = [];
  const notes = [];
  let kind = 'ok';

  // Sanity-check the dates we scraped before trusting them.
  if (evidence.launchDate && !isValidDate(evidence.launchDate)) evidence.launchDate = null;
  if (evidence.endDate && !isValidDate(evidence.endDate)) evidence.endDate = null;
  if (evidence.launchDate && evidence.endDate && evidence.endDate < evidence.launchDate) {
    evidence.state = 'unknown';
    evidence.note = 'source dates inconsistent (end before launch) — needs a human';
  }

  const set = (field, value) => {
    if (project[field] !== value) changes.push({ field, from: project[field] ?? null, to: value });
  };

  if (evidence.state === 'unknown') {
    kind = status === 'promo' ? 'ok' : 'unverified';
    notes.push(evidence.note || 'no source reachable');
    return { status, kind, changes, notes, evidence };
  }

  const realEnd = evidence.endDate;
  const realLaunch = evidence.launchDate;
  const realEndDate = realEnd ? new Date(realEnd + 'T23:59:59') : null;
  const realLaunchDate = realLaunch ? new Date(realLaunch + 'T00:00:00') : null;
  // The site keeps a campaign "live" for 24h past its stated end date, so a
  // campaign that closed yesterday is not a bug — it is the grace window.
  const closedRecently = realEndDate && addHours(realEndDate, 24) >= now;
  // Kicktraq reports the campaign's own calendar dates, so 1 day of drift is a
  // real error. Wayback/Gamefound give UTC timestamps whose calendar day can
  // differ from the date printed on the page, so allow a day of slack there.
  const driftTolerance = evidence.confidence === 'high' ? DATE_TOLERANCE : DATE_TOLERANCE + 1;

  if (evidence.state === 'active') {
    if (status === 'preview') {
      kind = 'mismatch';
      set('isPreview', false);
      if (realLaunch) set('launchDate', realLaunch);
      if (realEnd) set('endDate', realEnd);
      notes.push(`campaign is live${evidence.daysLeft ? ` with ${evidence.daysLeft} days left` : ''}`);
    } else if (status === 'upcoming') {
      if (realLaunchDate && realLaunchDate <= now) {
        kind = 'mismatch';
        set('launchDate', realLaunch);
        if (realEnd && realEnd !== project.endDate) set('endDate', realEnd);
        notes.push('campaign has already launched');
      } else if (realLaunch && project.launchDate !== realLaunch) {
        kind = 'drift';
        set('launchDate', realLaunch);
        notes.push(`launch date off by ${Math.abs(daysBetween(parseProjectDateTime(project.launchDate, project.launchTime, 'start'), realLaunchDate))}d`);
      }
    } else if (status === 'live') {
      if (realEnd && project.endDate !== realEnd && Math.abs(daysBetween(parseProjectDateTime(project.endDate, project.endTime, 'end'), realEndDate)) >= driftTolerance) {
        kind = 'drift';
        set('endDate', realEnd);
        notes.push(`end date off by ${Math.abs(daysBetween(parseProjectDateTime(project.endDate, project.endTime, 'end'), realEndDate))}d`);
      }
      if (realLaunch && project.launchDate !== realLaunch && Math.abs(daysBetween(parseProjectDateTime(project.launchDate, project.launchTime, 'start'), realLaunchDate)) >= driftTolerance) {
        if (kind === 'ok') kind = 'drift';
        set('launchDate', realLaunch);
        notes.push(`launch date off`);
      }
    } else if (status === 'archived') {
      kind = 'mismatch';
      set('isArchived', false);
      if (realLaunch) set('launchDate', realLaunch);
      if (realEnd) set('endDate', realEnd);
      notes.push('site shows archived but campaign is still live');
    }
  } else if (evidence.state === 'ended') {
    if (closedRecently && (status === 'live' || status === 'late-pledge' || status === 'pre-order')) {
      // Still inside the 24h grace window; only the end date matters.
      if (realEnd && project.endDate !== realEnd) {
        kind = 'drift';
        set('endDate', realEnd);
        notes.push('campaign just closed; end date corrected');
      } else {
        notes.push('campaign closed inside the 24h grace window');
      }
    } else if (status === 'preview') {
      kind = 'mismatch';
      set('isPreview', false);
      if (realLaunch) set('launchDate', realLaunch);
      if (realEnd) set('endDate', realEnd);
      set('isArchived', true);
      notes.push('campaign ran and ended');
    } else if (status === 'upcoming' || status === 'live') {
      kind = 'mismatch';
      if (realEnd) set('endDate', realEnd);
      const stillSellable = project.isLatePledge || project.hasLatePledge || project.latePledgeUrl || project.isPreOrder || project.hasPreOrder || project.preOrderUrl;
      if (stillSellable) {
        notes.push('has late-pledge/pre-order flags — verify those links still work');
      } else {
        set('isArchived', true); // force it off the live/upcoming lists immediately
      }
      notes.push('campaign has ended');
    } else if (status === 'archived') {
      if (realEnd && project.endDate !== realEnd) {
        kind = 'drift';
        set('endDate', realEnd);
        notes.push('end date corrected');
      }
    }
    // late-pledge / pre-order entries: nothing to assert without the page itself
  } else if (evidence.state === 'upcoming') {
    if (status === 'preview') {
      kind = 'mismatch';
      set('isPreview', false);
      if (realLaunch) set('launchDate', realLaunch);
      if (realEnd) set('endDate', realEnd);
      notes.push('dates announced — belongs in Upcoming');
    } else if (status === 'upcoming') {
      if (realLaunch && project.launchDate !== realLaunch && Math.abs(daysBetween(parseProjectDateTime(project.launchDate, project.launchTime, 'start'), realLaunchDate)) >= driftTolerance) {
        kind = 'drift';
        set('launchDate', realLaunch);
        if (realEnd && project.endDate !== realEnd) set('endDate', realEnd);
        notes.push('launch date off');
      }
    } else if (status === 'live') {
      kind = 'mismatch';
      notes.push('site shows it live but the campaign has not launched yet');
    }
  } else if (evidence.state === 'unlaunched') {
    if (status === 'live' || status === 'upcoming') {
      kind = 'mismatch';
      set('isPreview', true);
      set('launchDate', '');
      set('endDate', '');
      notes.push('page exists but the campaign has not launched');
    }
  }

  return { status, kind, changes, notes, evidence };
}

// ── Apply ──────────────────────────────────────────────────────────────────────
function applyFixes(content, fixes) {
  const bySlug = new Map(content.projects.map((p) => [p.slug, p]));
  for (const fix of fixes) {
    const p = bySlug.get(fix.slug);
    if (!p) continue;
    for (const c of fix.changes) {
      if (c.to === null || c.to === '') {
        if (c.field === 'launchDate' || c.field === 'endDate') p[c.field] = '';
        else delete p[c.field];
      } else {
        p[c.field] = c.to;
      }
    }
    // Keep isPreview consistent with the dates we just wrote.
    if (p.launchDate || p.endDate) p.isPreview = false;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(content, null, 2) + '\n');
}

// ── Report ─────────────────────────────────────────────────────────────────────
function fmtEvidence(e) {
  if (e.state === 'unknown') return e.note || 'no reachable source';
  const bits = [];
  bits.push(e.source || 'unknown source');
  if (e.state) bits.push(e.state);
  if (e.launchDate && e.endDate) bits.push(`${e.launchDate} → ${e.endDate}`);
  else if (e.endDate) bits.push(`ends ${e.endDate}`);
  else if (e.launchDate) bits.push(`starts ${e.launchDate}`);
  if (e.daysLeft !== null && e.daysLeft !== undefined) bits.push(`${e.daysLeft}d left`);
  if (e.note) bits.push(e.note);
  return bits.join(' · ');
}

async function main() {
  if (flag('--help') || flag('-h')) {
    log('Usage: node scripts/status-check.js [options]');
    log('  --fix                 apply the corrections to data/content.json (default: report only)');
    log('  --status=a,b        which site statuses to audit (default: live,upcoming,preview)');
    log('  --all               audit every project');
    log('  --project=slug      audit one project');
    log('  --platform=Kickstarter   filter by platform');
    log('  --limit=N           stop after N projects (useful for spot checks)');
    log('  --verbose           show confirmed-OK projects and per-source detail');
    log('  --quiet             summary only');
    log('  --concurrency=N     parallel fetches (default 6)');
    log('  --timeout=N         per-request seconds (default 12)');
    log('  --cache-ttl=N       cache hours (default 6); --no-cache forces a live fetch');
    log('  --date-tolerance=N  days of drift before a date is considered wrong (default 1)');
    log('  --min-confidence=   high|medium|low: lowest source confidence allowed to change data (default medium)');
    log('  --out=file.json     write a machine-readable report');
    log('  --data=path         alternate content.json to audit (default data/content.json)');
    log('  --verbose           also prints confirmed matches');
    return 0;
  }

  const now = new Date();
  const content = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  let projects = content.projects;

  if (PROJECT_FILTER) {
    const q = PROJECT_FILTER.toLowerCase();
    projects = projects.filter((p) => p.slug.toLowerCase() === q || (p.slug || '').toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q));
  }
  if (PLATFORM_FILTER) projects = projects.filter((p) => (p.platform || '').toLowerCase() === PLATFORM_FILTER.toLowerCase());
  if (!ALL_STATUSES) {
    projects = projects.filter((p) => STATUS_FILTER.includes(siteStatus(p, now)));
  }
  if (LIMIT) projects = projects.slice(0, LIMIT);

  log(`\nAuditing ${projects.length} projects (status filter: ${ALL_STATUSES ? 'all' : STATUS_FILTER.join(', ')})`, 'cyan');
  log(`Sources: kicktraq → direct → wayback · cache ${NO_CACHE ? 'disabled' : `${CACHE_TTL / 3600000}h TTL`} · ${CONCURRENCY} parallel`, 'dim');

  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < projects.length) {
      const project = projects[cursor++];
      try {
        const evidence = await resolveProject(project);
        results.push({ project, evidence, audit: audit(project, evidence, now) });
      } catch (e) {
        results.push({ project, evidence: { state: 'unknown', note: e.message }, audit: { status: siteStatus(project, now), kind: 'error', changes: [], notes: [e.message], evidence: {} } });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, projects.length) }, worker));

  const buckets = { ok: [], drift: [], mismatch: [], unverified: [], error: [] };
  results.forEach((r) => (buckets[r.audit.kind] || buckets.error).push(r));

  // Findings, worst first.
  for (const r of [...buckets.mismatch, ...buckets.drift, ...buckets.error]) {
    const { project, audit: a } = r;
    const icon = a.kind === 'mismatch' ? '⚠' : a.kind === 'drift' ? '~' : '✗';
    const color = a.kind === 'drift' ? 'yellow' : 'red';
    log(`  ${icon} ${project.title}  [site: ${a.status}]  ${fmtEvidence(a.evidence)}`, color);
    if (a.notes.length) log(`      ${a.notes.join('; ')}`, 'dim');
    if (a.changes.length) {
      log(`      → ${a.changes.map((c) => `${c.field}: ${c.from === null ? '∅' : JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join(', ')}`, 'cyan');
    }
  }

  if (buckets.unverified.length) {
    log(`\n  ? Not verifiable from this machine (${buckets.unverified.length}):`, 'dim');
    const names = buckets.unverified.map((r) => `${r.project.title} [${r.audit.status}]`);
    for (let i = 0; i < names.length; i += 5) log(`      ${names.slice(i, i + 5).join(' | ')}`, 'dim');
  }

  if (VERBOSE) {
    buckets.ok.forEach((r) => log(`  ✓ ${r.project.title} — ${r.audit.status} confirmed (${fmtEvidence(r.audit.evidence)})`, 'green'));
  }

  log('\n' + '─'.repeat(72), 'bold');
  log(`  Confirmed OK: ${buckets.ok.length}   Date drift: ${buckets.drift.length}   Status mismatch: ${buckets.mismatch.length}   Unverified: ${buckets.unverified.length}` + (buckets.error.length ? `   Errors: ${buckets.error.length}` : ''), 'bold');
  log('─'.repeat(72), 'bold');
  if (buckets.unverified.length) {
    log(`  ${buckets.unverified.length} projects could not be verified from this machine (Kickstarter campaigns Kicktraq does not track, or pages that are bot-blocked).`, 'dim');
    log('  Save those campaign pages into upstream/ and rerun — see docs/project-lookup.md.', 'dim');
  }

  const fixes = results.filter((r) => r.audit.changes.length && confScore(r.audit.evidence.confidence) >= confScore(MIN_CONFIDENCE)).map((r) => ({
    slug: r.project.slug,
    title: r.project.title,
    fromStatus: r.audit.status,
    confidence: r.audit.evidence.confidence,
    evidence: fmtEvidence(r.audit.evidence),
    changes: r.audit.changes,
  }));

  const skipped = results.filter((r) => r.audit.changes.length && confScore(r.audit.evidence.confidence) < confScore(MIN_CONFIDENCE));
  if (skipped.length) {
    log(`\n${skipped.length} suggested change(s) held back (source confidence below --min-confidence=${MIN_CONFIDENCE}):`, 'yellow');
    skipped.forEach((r) => log(`  · ${r.project.title} (${fmtEvidence(r.audit.evidence)})`, 'dim'));
  }

  if (OUT_FILE) {
    fs.writeFileSync(path.resolve(OUT_FILE), JSON.stringify({
      generatedAt: new Date().toISOString(),
      checked: results.length,
      summary: { ok: buckets.ok.length, drift: buckets.drift.length, mismatch: buckets.mismatch.length, unverified: buckets.unverified.length, error: buckets.error.length },
      findings: fixes,
      unverified: buckets.unverified.map((r) => ({ slug: r.project.slug, title: r.project.title, status: r.audit.status, note: r.audit.notes.join('; ') })),
    }, null, 2));
    log(`Report written to ${OUT_FILE}`, 'green');
  }

  if (!fixes.length) {
    log('Nothing to change.', 'green');
    return 0;
  }

  if (FIX) {
    const backup = path.join(CACHE_DIR, `content-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(backup, fs.readFileSync(DATA_FILE, 'utf8'));
    applyFixes(content, fixes);
    log(`Applied ${fixes.length} project corrections to data/content.json (backup: ${backup})`, 'green');
    log('Next: node scripts/validate-content.js && git commit', 'dim');
    return 0;
  }

  log(`${fixes.length} corrections pending — rerun with --fix to apply.`, 'yellow');
  return 1;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    log(`FATAL: ${e.message}`, 'red');
    if (VERBOSE) log(e.stack, 'dim');
    process.exit(1);
  });
