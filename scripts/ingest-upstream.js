#!/usr/bin/env node
/**
 * ingest-upstream.js — read saved campaign pages from upstream/ and add the
 * missing projects to data/content.json.
 *
 *   node scripts/ingest-upstream.js                      # ingest everything new
 *   node scripts/ingest-upstream.js --dry-run            # report only, write nothing
 *   node scripts/ingest-upstream.js --verbose            # per-project detail
 *   node scripts/ingest-upstream.js --dir=upstream
 *   node scripts/ingest-upstream.js --no-images         # skip art download
 *   node scripts/ingest-upstream.js --cleanup           # delete saved pages once ingested
 *
 * What it does, in one pass:
 *   1. parses each saved page (og: meta + Kickstarter's inline project_* data)
 *   2. skips anything already in content.json (by primaryUrl or slug)
 *   3. converts launch/deadline to Pacific time -> launchDate/endDate/endTime
 *   4. downloads the og:image, re-encodes to JPEG (<=1600px, q82) into uploads/
 *   5. appends the project, plus any missing designer/publisher profiles
 *
 * Idempotent: running it twice adds nothing.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
const noImages = args.includes("--no-images");
const cleanup = args.includes("--cleanup");
const dirArg = args.find((a) => a.startsWith("--dir=")) ? args.find((a) => a.startsWith("--dir=")).split("=")[1] : "upstream";
const dir = path.isAbsolute(dirArg) ? dirArg : path.join(ROOT, dirArg);
const DATA = path.join(ROOT, "data", "content.json");
const UPLOADS = path.join(ROOT, "uploads");
const MAX_EDGE = 1600;
const QUALITY = 82;

const IM = ["magick", "convert"].find((bin) => spawnSync(bin, ["-version"]).status === 0);

const color = (c, s) => ({ red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m" }[c] + s + "\x1b[0m");
const log = (s, c) => process.stdout.write((c ? color(c, s) : s) + "\n");

function meta(html, key) {
  const m =
    html.match(new RegExp(`(?:property|name)="${key}" content="([^"]+)"`, "i")) ||
    html.match(new RegExp(`content="([^"]+)" (?:property|name)="${key}"`, "i"));
  if (!m) return "";
  return m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").trim();
}

function jsonField(html, key) {
  const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i"));
  if (!m) return "";
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

function toPacific(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

function platformOf(url) {
  if (/kickstarter\.com/i.test(url)) return "Kickstarter";
  if (/gamefound\.com/i.test(url)) return "Gamefound";
  if (/backerkit\.com/i.test(url)) return "Backerkit";
  if (/indiegogo\.com/i.test(url)) return "Indiegogo";
  return "Crowdfunding";
}

function slugOf(url) {
  const parts = url.split("/").filter(Boolean);
  return (parts[parts.length - 1] || "").toLowerCase();
}

async function saveImage(imageUrl, slug, dryRun = false) {
  if (!imageUrl) return { local: "", note: "no og:image on the page" };
  if (!IM) return { local: "", note: "ImageMagick not installed — left as remote URL" };
  try {
    const res = await fetch(imageUrl, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36" } });
    if (!res.ok) return { local: "", note: `image HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) return { local: "", note: `image too small (${buf.length} bytes)` };
    if (dryRun) return { local: `/uploads/${slug}.jpg`, bytes: buf.length, note: "dry run: not written" };
    const tmp = path.join(UPLOADS, `.tmp-${slug}`);
    fs.writeFileSync(tmp, buf);
    const out = path.join(UPLOADS, `${slug}.jpg`);
    const r = spawnSync(IM, [tmp, "-background", "white", "-flatten", `-resize`, `${MAX_EDGE}x${MAX_EDGE}>`, "-quality", String(QUALITY), out]);
    fs.unlinkSync(tmp);
    if (r.status !== 0) return { local: "", note: "ImageMagick re-encode failed" };
    return { local: `/uploads/${slug}.jpg`, bytes: fs.statSync(out).size };
  } catch (e) {
    return { local: "", note: `image fetch failed: ${e.message}` };
  }
}

(async () => {
  if (!fs.existsSync(dir)) {
    log(`No ${dir} directory — nothing to ingest.`, "yellow");
    process.exit(1);
  }
  const pages = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".html"));
  if (!pages.length) {
    log(`No saved pages in ${dir}/.`, "yellow");
    process.exit(0);
  }

  const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const urls = new Set(data.projects.map((p) => (p.primaryUrl || "").replace(/\/$/, "")));
  const slugs = new Set(data.projects.map((p) => p.slug));
  const designerNames = new Set(data.designers.map((d) => d.name));
  const publisherNames = new Set(data.publishers.map((d) => d.name));

  const added = [];
  const skipped = [];
  const cleaned = [];
  const kept = [];

  for (const file of pages) {
    const html = fs.readFileSync(path.join(dir, file), "utf8");
    const url = (meta(html, "og:url") || "").replace(/\/$/, "");
    const title = jsonField(html, "project_name") || meta(html, "og:title");
    if (!title) {
      skipped.push(`${file} — could not read a campaign title`);
      kept.push(file);
      continue;
    }
    const slug = slugOf(url);
    if (!slug) {
      skipped.push(`${file} — no canonical URL`);
      kept.push(file);
      continue;
    }
    if (urls.has(url) || slugs.has(slug)) {
      skipped.push(`${slug} — already in content.json`);
      if (cleanup && !dryRun) cleaned.push(file);
      continue;
    }

    const creator = jsonField(html, "project_creator_name") || "";
    const launched = toPacific(jsonField(html, "project_launched_at"));
    const deadline = toPacific(jsonField(html, "project_deadline"));
    const isPreview = !(launched.date && deadline.date);
    const summary = (meta(html, "og:description") || meta(html, "description")).replace(/\s+/g, " ").trim();

    const image = noImages ? { local: "", note: "--no-images" } : await saveImage(meta(html, "og:image") || meta(html, "twitter:image"), slug, dryRun);
    const localImage = image.local || meta(html, "og:image") || "";

    const entry = {
      slug,
      title,
      summary,
      image: localImage,
      platform: platformOf(url),
      launchDate: launched.date,
      endDate: deadline.date,
      ...(deadline.time ? { endTime: deadline.time } : {}),
      isPreview,
      primaryUrl: url,
      designer: creator,
      publisher: creator,
      promoDetails: "",
    };

    added.push({ entry, imageNote: image.note, bytes: image.bytes, creator });
    if (cleanup && !dryRun) cleaned.push(file);

    if (verbose) {
      log(`\n${title}  (${slug})`, "cyan");
      log(`  creator   ${creator}   state ${jsonField(html, "project_state")}   ${jsonField(html, "project_subcategory")}`, "dim");
      log(`  dates     ${launched.date || "preview"} ${launched.time} -> ${deadline.date} ${deadline.time}`, "dim");
      log(`  summary   ${summary.slice(0, 120)}`, "dim");
      if (image.note) log(`  image     ${image.note}`, "dim");
    }

    if (!dryRun) {
      data.projects.push(entry);
      if (creator) {
        const personSlug = creator.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        for (const [arr, names] of [[data.designers, designerNames], [data.publishers, publisherNames]]) {
          if (!names.has(creator)) {
            names.add(creator);
            arr.push({ slug: personSlug, name: creator, bggUrl: "", bio: "" });
          }
        }
      }
    }
  }

  log(`\nScanned ${pages.length} saved page(s) in ${dir}/`, "bold");
  if (added.length) {
    log(`${added.length} new project(s):`, "green");
    added.forEach((a) =>
      log(
        `  ${a.entry.slug}  ${a.entry.isPreview ? "[preview]" : `[${a.entry.launchDate} -> ${a.entry.endDate} ${a.entry.endTime || ""}]`}` +
          (a.bytes ? `  art ${Math.round(a.bytes / 1024)} KB` : ""),
        "green"
      )
    );
  }
  if (skipped.length) {
    log(`${skipped.length} skipped:`, "dim");
    skipped.forEach((s) => log(`  ${s}`, "dim"));
  }
  if (kept.length) log(`Kept for a human (unparseable): ${kept.join(", ")}`, "yellow");

  function runCleanup() {
    if (!cleanup || dryRun || !cleaned.length) return 0;
    let freed = 0;
    for (const file of cleaned) {
      const p = path.join(dir, file);
      freed += fs.statSync(p).size;
      fs.unlinkSync(p);
      // a browser-save leaves a sibling "<name>_files" asset folder; it is spent once ingested
      const stem = file.replace(/\.html$/i, "");
      const assets = path.join(dir, `${stem}_files`);
      if (fs.existsSync(assets) && fs.statSync(assets).isDirectory()) {
        for (const a of fs.readdirSync(assets)) freed += fs.statSync(path.join(assets, a)).size;
        fs.rmSync(assets, { recursive: true, force: true });
      }
    }
    // orphaned asset folders left by a browser save with no matching page
    for (const entry of fs.readdirSync(dir)) {
      const assets = path.join(dir, entry);
      if (entry.toLowerCase().endsWith("_files") && fs.existsSync(assets) && fs.statSync(assets).isDirectory()) {
        for (const a of fs.readdirSync(assets)) freed += fs.statSync(path.join(assets, a)).size;
        fs.rmSync(assets, { recursive: true, force: true });
      }
    }
    log(`Cleaned ${cleaned.length} saved page(s) from ${dir}/ (${(freed / 1048576).toFixed(1)} MB freed).`, "cyan");
    return freed;
  }

  if (!added.length) {
    log("Nothing to add — upstream/ is already ingested.", "yellow");
    runCleanup();
    process.exit(0);
  }

  if (dryRun) {
    log("Dry run: content.json untouched, nothing deleted.", "yellow");
    process.exit(0);
  }

  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
  log(`Wrote ${added.length} project(s) to data/content.json.`, "green");
  runCleanup();
  log("Next: node scripts/validate-content.js && node scripts/ui-smoke.js, then git add data/content.json uploads/ && git commit", "cyan");
})();
