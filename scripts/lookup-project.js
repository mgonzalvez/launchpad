#!/usr/bin/env node
/**
 * lookup-project.js — turn a Kickstarter/Gamefound/Backerkit URL into a
 * content.json-ready project object, using whatever source is reachable.
 *
 * Why this exists: from this machine's egress IP (Apple corp, AS7018) the
 * campaign pages themselves are Cloudflare-challenged — curl, curl with
 * browser headers, and headless Chromium all get "Just a moment...".
 * So the script walks a chain of fallbacks and reports what it could and
 * could not prove.
 *
 * Usage:
 *   node scripts/lookup-project.js <url> [--verbose] [--out project.json]
 *   node scripts/lookup-project.js --file saved.html [--url <original url>]
 *   node scripts/lookup-project.js <url> --save-wayback   # ask IA to crawl it, then read the snapshot
 *
 * Env:
 *   JINA_API_KEY   enables https://r.jina.ai/<url> (reader proxy, bypasses IP block)
 *   LOOKUP_PROXY   a generic "fetch this URL for me" proxy, e.g. a CF Worker you deploy
 */

const fs = require("fs");

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const SAVE_WAYBACK = args.includes("--save-wayback");
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const name = args[i].slice(2);
    if (name.includes("=")) flags[name.split("=")[0]] = name.split("=")[1];
    else if (args[i + 1] && !args[i + 1].startsWith("--")) { flags[name] = args[i + 1]; i++; }
    else flags[name] = true;
  }
}
const inputUrl = flags.url || args.find((a) => /^https?:\/\//.test(a)) || null;
const saveWayback = SAVE_WAYBACK || flags["save-wayback"] === true;
const inputFile = flags.file || null;
const outFile = flags.out || null;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function log(msg, color) {
  const c = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m", reset: "\x1b[0m" };
  process.stdout.write((c[color] || "") + msg + c.reset + "\n");
}

async function get(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers },
      redirect: "follow",
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: "", error: e.message };
  }
}

// ── Source chain ──────────────────────────────────────────────────────────────

async function waybackLatest(url) {
  const cdx = await get(
    `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&filter=statuscode:200&collapse=urlkey&limit=1&fl=timestamp,original`
  );
  if (!cdx.ok) return null;
  try {
    const rows = JSON.parse(cdx.body);
    if (!rows || rows.length < 2) return null;
    const ts = rows[1][0];
    const snap = await get(`https://web.archive.org/web/${ts}id_/${rows[1][1]}`);
    return snap.ok ? { ts, body: snap.body } : null;
  } catch {
    return null;
  }
}

async function waybackSaveThenRead(url) {
  log(`  asking archive.org to crawl ${url} ...`, "dim");
  await get(`https://web.archive.org/save/${url}`);
  await new Promise((r) => setTimeout(r, 8000));
  return waybackLatest(url);
}

async function readerProxy(url) {
  const tries = [];
  if (process.env.JINA_API_KEY) {
    tries.push({ name: "r.jina.ai", url: `https://r.jina.ai/${url}`, headers: { Authorization: `Bearer ${process.env.JINA_API_KEY}` } });
  }
  if (process.env.LOOKUP_PROXY) {
    tries.push({ name: "custom proxy", url: `${process.env.LOOKUP_PROXY}${encodeURIComponent(url)}` });
  }
  for (const t of tries) {
    const r = await get(t.url, t.headers);
    if (r.ok && r.body.length > 500) return { name: t.name, body: r.body };
  }
  return null;
}

// DuckDuckGo's html endpoint is not bot-challenged and snippets carry dates.
async function serpSnippets(url) {
  const titleGuess = (url.split("/").slice(-1)[0] || "").replace(/-/g, " ");
  const queries = [
    encodeURIComponent(`${titleGuess} kickstarter`),
    encodeURIComponent(`"${titleGuess}" campaign ends`),
  ];
  let r = null;
  for (const endpoint of ["https://html.duckduckgo.com/html/?q=", "https://lite.duckduckgo.com/lite/?q="]) {
    for (const q of queries) {
      r = await get(endpoint + q, { "User-Agent": "curl/8.4.0" });
      if (r.ok && /result__a|result-link/.test(r.body)) return parseSerp(r.body);
    }
  }
  return [];
}

function parseSerp(body) {
  const out = [];
  for (const m of body.matchAll(/class="result__a" href="([^"]+)">(.*?)<\/a>/g)) {
    out.push({
      url: decodeURIComponent((m[1].split("uddg=")[1] || m[1]).split("&")[0]),
      title: strip(m[2]),
    });
  }
  for (const m of body.matchAll(/class="result__snippet"[^>]*>(.*?)<\/a>/g)) {
    out.push({ snippet: strip(m[1]) });
  }
  for (const m of body.matchAll(/class="result-link"[^>]*>(.*?)<\/a>/g)) {
    out.push({ title: strip(m[1]) });
  }
  return out;
}

function strip(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

// ── Extraction ────────────────────────────────────────────────────────────────

function extract(html, url) {
  if (!url) {
    const og = html.match(/property="og:url" content="([^"]+)"/i);
    if (og) url = og[1];
  }
  const d = { primaryUrl: url };
  const meta = (key) => {
    const m =
      html.match(new RegExp(`<meta\\s+(?:property|name)=["']${key}["']\\s+content=["']([^"']+)["']`, "i")) ||
      html.match(new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+(?:property|name)=["']${key}["']`, "i"));
    return m ? m[1].trim() : null;
  };

  const rawTitle = meta("og:title") || (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || null;
  d.title = rawTitle ? rawTitle.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() : null;
  d.summary = (meta("og:description") || meta("description") || "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").trim() || null;
  d.image = meta("og:image") || meta("twitter:image") || null;

  // Kickstarter's inline kicker JSON: "deadline", "launched_at", "goal", "pledged", "backer_count"
  const iso = (key) => {
    const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([0-9T:Z-]+)"`, "i"));
    return m ? m[1] : null;
  };
  const num = (key) => {
    const m = html.match(new RegExp(`"${key}"\\s*:\\s*([0-9.]+)`, "i"));
    return m ? Number(m[1]) : null;
  };

  // Kickstarter nests its campaign data as "project_deadline" / "project_launched_at"
  const deadline = iso("project_deadline") || iso("deadline") || iso("endDate") || iso("end_date");
  const launched = iso("project_launched_at") || iso("launched_at") || iso("startDate") || iso("start_date");
  if (deadline) d.endDate = deadline.slice(0, 10);
  if (launched) d.launchDate = launched.slice(0, 10);
  d.goal = num("goal");
  d.pledged = num("pledged");
  d.backers = num("backer_count");

  // Human-readable dates, if the JSON blob isn't there
  if (!d.endDate) {
    const m = html.match(/(?:Campaign ends|Ends|Deadline)[:\s]+([A-Z][a-z]+ \d{1,2},? \d{4})/i);
    if (m) d.endDate = isoDate(m[1]);
  }
  if (!d.launchDate) {
    const m = html.match(/(?:Campaign launched|Launched|Started)[:\s]+([A-Z][a-z]+ \d{1,2},? \d{4})/i);
    if (m) d.launchDate = isoDate(m[1]);
  }

  // Creator / publisher
  const by = html.match(/(?:Campaign by|Created by|by)\s*<[^>]*>([^<]{3,60})</i);
  if (by) d.publisher = strip(by[1]);
  const creatorJson = html.match(/"creator"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i) || html.match(/"project_creator_name"\s*:\s*"([^"]+)"/i);
  if (creatorJson) d.publisher = creatorJson[1];
  const country = (html.match(/"project_country"\s*:\s*"([^"]+)"/i) || [])[1];
  if (country) d._country = country;

  // og:title on both platforms is "<Project> by <Creator>"
  if (d.title) {
    const m = d.title.match(/^(.*?)\s+by\s+([^|]+?)(?:\s*\|\s*\w+)?$/);
    if (m && !d.publisher) { d.publisher = m[2].trim(); d._titleOnly = m[1].trim(); }
  }

  d.platform = /kickstarter\.com/i.test(url) ? "Kickstarter" : /gamefound\.com/i.test(url) ? "Gamefound" : /backerkit\.com/i.test(url) ? "Backerkit" : "Crowdfunding";
  d.slug = d.slug || (url.split("/").filter(Boolean).slice(-1)[0] || "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return d;
}

function isoDate(s) {
  const m = s.match(/([A-Za-z]+) (\d{1,2}),? (\d{4})/);
  if (!m) return null;
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const mo = months[m[1].slice(0, 3).toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  if (!inputUrl && !inputFile) {
    console.error("Usage: node scripts/lookup-project.js <url> [--verbose] [--out file.json]");
    process.exit(2);
  }

  const project = {};
  const provenance = [];
  let html = null;

  if (inputFile) {
    html = fs.readFileSync(inputFile, "utf8");
    provenance.push({ source: "saved page", detail: inputFile });
  }

  if (!html && inputUrl) {
    // 1. direct
    const r = await get(inputUrl);
    if (r.ok && !/Just a moment|cf-chl|Challenge|attention required/i.test(r.body.slice(0, 2000))) {
      html = r.body;
      provenance.push({ source: "direct fetch", detail: `HTTP ${r.status}, ${r.body.length} bytes` });
    } else {
      log(`  direct fetch blocked (HTTP ${r.status}) — Cloudflare challenge`, "yellow");
    }
  }

  // 2. reader proxy (needs a key or your own proxy)
  if (!html && inputUrl) {
    const p = await readerProxy(inputUrl);
    if (p) {
      html = p.body;
      provenance.push({ source: p.name, detail: `${p.body.length} chars` });
    }
  }

  // 3. wayback
  if (!html && inputUrl) {
    const wb = saveWayback ? await waybackSaveThenRead(inputUrl) : await waybackLatest(inputUrl);
    if (wb) {
      html = wb.body;
      provenance.push({ source: "wayback snapshot", detail: wb.ts });
    } else {
      log("  wayback has no snapshot of this page", "yellow");
    }
  }

  if (html) {
    Object.assign(project, extract(html, inputUrl || ""));
  }

  // 4. SERP snippets — always worth a pass, good for cross-checking dates
  if (inputUrl) {
    const serp = await serpSnippets(inputUrl);
    if (serp.length) {
      provenance.push({ source: "duckduckgo snippets", detail: `${serp.length} results` });
      for (const s of serp.slice(0, 6)) {
        const text = `${s.title || ""} ${s.snippet || ""}`;
        const dm = text.match(/\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/g);
        if (dm && !project._serpDates) project._serpDates = [];
        if (dm) project._serpDates.push(...dm.map(isoDate));
      }
      project._relatedLinks = serp.filter((s) => s.url).slice(0, 5).map((s) => s.url);
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  const known = ["title", "summary", "image", "platform", "designer", "publisher", "launchDate", "endDate", "primaryUrl"];
  const missing = known.filter((k) => !project[k]);

  log("\n=== Lookup result ===", "cyan");
  console.log(JSON.stringify(project, null, 2));

  log("\nSources actually reached:", "bold");
  provenance.forEach((p) => log(`  ${p.source} — ${p.detail}`, "dim"));

  if (missing.length) {
    log(`\nStill needs a human (these cannot be guessed): ${missing.join(", ")}`, "yellow");
    log("Fastest fix: open the campaign in your browser, then either");
    log("  (a) paste the page text here, or");
    log("  (b) Save Page As... and run: node scripts/lookup-project.js --file saved.html");
  }

  if (outFile) {
    fs.writeFileSync(outFile.split("=")[1], JSON.stringify(project, null, 2));
    log(`Wrote ${outFile.split("=")[1]}`, "green");
  }
})();
