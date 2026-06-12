#!/usr/bin/env node
// kicktraq-check.js — Cross-reference content.json project statuses against Kicktraq.
// Usage: node scripts/kicktraq-check.js [--fix] [--verbose]
//
// Reads data/content.json, fetches Kicktraq feeds and individual project pages,
// compares statuses, and outputs a report with suggested fixes.
//
// --fix   : Apply suggested date fixes to content.json (DANGEROUS — dry run by default)
// --verbose : Show detailed per-project output

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FIX_MODE = args.includes("--fix");
const VERBOSE = args.includes("--verbose");

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg, color) {
  const colors = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    reset: "\x1b[0m",
  };
  const c = colors[color] || "";
  process.stdout.write(c + msg + colors.reset + "\n");
}

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod
      .get(url, { headers: { "User-Agent": "LaunchpadKicktraqCheck/1.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirects
          fetchURL(res.headers.location).then(resolve, reject);
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          } else {
            resolve(data);
          }
        });
      })
      .on("error", reject);
  });
}

function parseRSS(xml) {
  // Extract <item> blocks from RSS XML
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = extractTag(item, "title");
    const link = extractTag(item, "link");
    const description = extractTag(item, "description");
    if (title && link) {
      items.push({ title: title.trim(), link: link.trim(), description: description || "" });
    }
  }
  return items;
}

function extractTag(html, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = html.match(regex);
  if (!match) return null;
  let content = match[1];
  // Strip CDATA wrappers
  content = content.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
  // Strip HTML tags from content
  content = content.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#91;/g, "[").replace(/&#93;/g, "]").replace(/&pound;/g, "£").replace(/&euro;/g, "€");
  return content;
}

function extractKicktraqProjectInfo(html) {
  const info = {};

  // og:url meta → canonical KS URL
  const ogUrlMatch = html.match(/<meta property="og:url" content="([^"]+)"/);
  info.canonicalUrl = ogUrlMatch ? ogUrlMatch[1] : null;

  // Project category
  const catMatch = html.match(/class="project-cat"[^>]*>[^<]*<[^>]*>([^<]*)/);
  info.category = catMatch ? catMatch[1].trim() : null;

  // Funding progress
  const pledgedMatch = html.match(/class="project-pledged"[^>]*>[^<]*([\d.,£$€]+)/);
  info.pledged = pledgedMatch ? pledgedMatch[1].trim() : null;

  // Also try description for funding: [currently £1,555 (311%) of £500 goal]
  const descMatch = html.match(/\[currently\s*([^\]]+)\]/);
  if (descMatch) {
    info.fundingBracket = descMatch[1].trim();
  }

  // Ended status — check for "ended" class in the page
  info.ended = /ended/.test(html);

  // Countdown (days, hours, mins, secs)
  const daysMatch = html.match(/id="clock-days">(\d+)/);
  const hoursMatch = html.match(/id="clock-hours">(\d+)/);
  const minsMatch = html.match(/id="clock-mins">(\d+)/);
  const secsMatch = html.match(/id="clock-secs">(\d+)/);
  info.daysLeft = daysMatch ? parseInt(daysMatch[1], 10) : null;
  info.hoursLeft = hoursMatch ? parseInt(hoursMatch[1], 10) : null;
  info.minsLeft = minsMatch ? parseInt(minsMatch[1], 10) : null;
  info.secsLeft = secsMatch ? parseInt(secsMatch[1], 10) : null;

  // Title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  info.title = titleMatch ? titleMatch[1].replace(/\s*::\s*Kicktraq$/, "").trim() : null;

  return info;
}

function ksUrlToKicktraqUrl(ksUrl) {
  // https://www.kickstarter.com/projects/owner/project-slug → https://www.kicktraq.com/projects/owner/project-slug/
  // KS URLs can be "owner/project-name" (two segments) or just "project-name" (one segment)
  const match = ksUrl.match(/kickstarter\.com\/projects\/([^/?#]+)/);
  if (!match) return null;
  return `https://www.kicktraq.com/projects/${match[1]}/`;
}

function isBoardOrCardGame(category) {
  if (!category) return true; // If we can't determine, assume it might be relevant
  const lower = category.toLowerCase();
  // Exclude non-board/card game categories
  const excluded = [
    "3d printing",
    "stl",
    "miniatures",
    "wargaming",
    "figurines",
    "robots",
    "calendar",
    "comic",
    "merch",
    "fashion",
    "food",
    "technology",
    "gadgets",
    "app",
    "software",
  ];
  return !excluded.some((e) => lower.includes(e));
}

// ── Status comparison ─────────────────────────────────────────────────────────

function compareStatus(ourStatus, kicktraqInfo) {
  // Returns { match: bool, issue: string, suggestedFix: { launchDate?, endDate?, isPreview? } }
  if (!kicktraqInfo) {
    // Not found on Kicktraq at all
    if (ourStatus === "live" || ourStatus === "late-pledge" || ourStatus === "pre-order") {
      return {
        match: false,
        issue: `Project is ${ourStatus} on our site but NOT FOUND on Kicktraq. Campaign may not have launched yet.`,
        suggestedFix: { isPreview: true },
      };
    }
    if (ourStatus === "upcoming") {
      return { match: true, issue: null, suggestedFix: null };
    }
    if (ourStatus === "archived") {
      return { match: true, issue: null, suggestedFix: null };
    }
    return { match: true, issue: null, suggestedFix: null };
  }

  // If Kicktraq says ended but we think it's live/upcoming
  if (kicktraqInfo.ended && (ourStatus === "live" || ourStatus === "upcoming" || ourStatus === "preview")) {
    return {
      match: false,
      issue: `Kicktraq shows campaign ENDED but our site shows ${ourStatus}.`,
      suggestedFix: null, // Can't determine exact end date from Kicktraq alone
    };
  }

  // If Kicktraq shows 0 days left but we think it's live (could be same day)
  if (kicktraqInfo.daysLeft === 0 && kicktraqInfo.hoursLeft === 0 && ourStatus === "live") {
    // Could be ending today — not necessarily wrong
    return {
      match: true,
      issue: null,
      suggestedFix: null,
    };
  }

  // If Kicktraq has the project and it's live, and we say upcoming — check if dates align
  if (!kicktraqInfo.ended && ourStatus === "upcoming") {
    return {
      match: false,
      issue: `Kicktraq shows campaign ACTIVE but our site shows UPCOMING. Campaign may have launched early.`,
      suggestedFix: null,
    };
  }

  // If Kicktraq has the project and it's live, and we say preview
  if (!kicktraqInfo.ended && ourStatus === "preview") {
    return {
      match: false,
      issue: `Kicktraq shows campaign ACTIVE but our site shows PREVIEW.`,
      suggestedFix: null,
    };
  }

  // If Kicktraq has the project and it's ended, and we say live/upcoming
  if (kicktraqInfo.ended && (ourStatus === "live" || ourStatus === "upcoming")) {
    return {
      match: false,
      issue: `Kicktraq shows campaign ENDED but our site shows ${ourStatus}.`,
      suggestedFix: null,
    };
  }

  return { match: true, issue: null, suggestedFix: null };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log("Loading content.json...", "cyan");
  const contentPath = path.join(__dirname, "..", "data", "content.json");
  const content = JSON.parse(fs.readFileSync(contentPath, "utf8"));
  const projects = content.projects;

  log(`Found ${projects.length} projects in content.json`, "cyan");

  // Build KS URL → project map
  const urlToProject = {};
  projects.forEach((p) => {
    if (p.primaryUrl && p.primaryUrl.includes("kickstarter.com")) {
      urlToProject[p.primaryUrl] = p;
    }
  });

  log("Fetching Kicktraq feeds...", "cyan");

  // Fetch the tabletop games latest/ending RSS feed
  let kicktraqItems = [];
  try {
    const rssUrl = "https://www.kicktraq.com/categories/games/tabletop%20games/latest.rss";
    const rssXml = await fetchURL(rssUrl);
    kicktraqItems = parseRSS(rssXml);
    log(`  Fetched ${kicktraqItems.length} items from Kicktraq tabletop games feed`, "cyan");
  } catch (e) {
    log(`  Warning: Failed to fetch RSS feed: ${e.message}`, "yellow");
  }

  // Also fetch the active projects list page
  let kicktraqProjectUrls = new Set();
  try {
    const projectsPage = await fetchURL("https://www.kicktraq.com/projects/");
    const urlRegex = /<a href="\/projects\/([^"]+?)\/?"/g;
    let m;
    while ((m = urlRegex.exec(projectsPage)) !== null) {
      kicktraqProjectUrls.add(m[1]);
    }
    log(`  Found ${kicktraqProjectUrls.size} active projects on Kicktraq projects page`, "cyan");
  } catch (e) {
    log(`  Warning: Failed to fetch projects page: ${e.message}`, "yellow");
  }

  // Build set of Kicktraq project paths for quick lookup
  const kicktraqPaths = new Set(kicktraqProjectUrls);

  // Results
  const results = {
    matched: [],
    mismatches: [],
    notOnKicktraq: [],
    errors: [],
  };

  // Check each Kickstarter project
  const ksProjects = projects.filter((p) => p.platform === "Kickstarter");
  log(`\nChecking ${ksProjects.length} Kickstarter projects against Kicktraq...`, "cyan");

  for (const project of ksProjects) {
    const ksUrl = project.primaryUrl;

    // Skip if primaryUrl is not actually a Kickstarter URL
    if (!ksUrl.includes("kickstarter.com")) {
      log(`  ~ ${project.title}: platform=Kickstarter but URL is ${ksUrl} — skipping`, "dim");
      continue;
    }

    const kicktraqUrl = ksUrlToKicktraqUrl(ksUrl);

    if (!kicktraqUrl) {
      results.errors.push({ project, error: "Could not map KS URL to Kicktraq URL" });
      continue;
    }

    // Check if project path is in Kicktraq's active list
    const kicktraqPath = kicktraqUrl.replace("https://www.kicktraq.com/projects/", "").replace(/\/$/, "");

    if (!kicktraqPaths.has(kicktraqPath)) {
      // Not on Kicktraq at all
      results.notOnKicktraq.push(project);
      continue;
    }

    // Fetch individual project page for detailed info
    let kicktraqInfo = null;
    try {
      const html = await fetchURL(kicktraqUrl);
      kicktraqInfo = extractKicktraqProjectInfo(html);
    } catch (e) {
      results.errors.push({ project, error: `Failed to fetch Kicktraq page: ${e.message}` });
      continue;
    }

    // Determine our current status
    const now = new Date();
    const isPreview = Boolean(project.isPreview) || (!project.launchDate && !project.endDate);
    let ourStatus = "preview";
    if (!isPreview) {
      const launch = new Date(project.launchDate + "T00:00:00");
      const end = new Date(project.endDate + "T23:59:59");
      if (launch > now) ourStatus = "upcoming";
      else if (end < now) {
        if (project.isLatePledge || project.hasLatePledge || project.latePledgeUrl) ourStatus = "late-pledge";
        else if (project.isPreOrder || project.hasPreOrder || project.preOrderUrl) ourStatus = "pre-order";
        else ourStatus = "archived";
      } else {
        ourStatus = "live";
      }
    }

    const comparison = compareStatus(ourStatus, kicktraqInfo);

    if (comparison.match) {
      results.matched.push({ project, kicktraqInfo, ourStatus });
    } else {
      results.mismatches.push({ project, kicktraqInfo, ourStatus, comparison });
    }

    // Rate limit: be nice to Kicktraq
    await new Promise((r) => setTimeout(r, 200));
  }

  // ── Output report ───────────────────────────────────────────────────────────

  log("\n" + "=".repeat(70), "bold");
  log("  KICKTRAQ VERIFICATION REPORT", "bold");
  log("=".repeat(70), "bold");

  // Summary
  log(`\n  Total KS projects: ${ksProjects.length}`, "cyan");
  log(`  Matched:           ${results.matched.length}`, "green");
  log(`  Mismatches:        ${results.mismatches.length}`, results.mismatches.length > 0 ? "red" : "green");
  log(`  Not on Kicktraq:   ${results.notOnKicktraq.length}`, "yellow");
  log(`  Errors:            ${results.errors.length}`, results.errors.length > 0 ? "red" : "dim");

  // Mismatches
  if (results.mismatches.length > 0) {
    log("\n" + "─".repeat(70), "bold");
    log("  MISMATCHES", "red");
    log("─".repeat(70));

    for (const { project, kicktraqInfo, ourStatus, comparison } of results.mismatches) {
      log(`\n  ⚠ ${project.title}`, "yellow");
      log(`    Our status:  ${ourStatus}`, "yellow");
      log(`    Kicktraq:    ${kicktraqInfo.ended ? "ENDED" : `ACTIVE (${kicktraqInfo.daysLeft}d left)`}`, kicktraqInfo.ended ? "red" : "green");
      log(`    Issue:       ${comparison.issue}`, "red");
      if (comparison.suggestedFix) {
        log(`    Suggested:   Set ${JSON.stringify(comparison.suggestedFix)}`, "cyan");
      }
    }
  }

  // Not on Kicktraq
  if (results.notOnKicktraq.length > 0) {
    log("\n" + "─".repeat(70), "bold");
    log(`  NOT ON KICKTRAQ (${results.notOnKicktraq.length} projects)`, "yellow");
    log("─".repeat(70));

    for (const project of results.notOnKicktraq) {
      const status = (() => {
        const now = new Date();
        const isPreview = Boolean(project.isPreview) || (!project.launchDate && !project.endDate);
        if (isPreview) return "preview";
        const launch = new Date(project.launchDate + "T00:00:00");
        const end = new Date(project.endDate + "T23:59:59");
        if (launch > now) return "upcoming";
        if (end < now) return "archived";
        return "live";
      })();

      if (status === "live" || status === "late-pledge" || status === "pre-order") {
        log(`  ⚠ ${project.title} (status: ${status}) — NOT on Kicktraq`, "yellow");
        log(`    → Campaign may not have launched yet. Consider setting isPreview: true`, "dim");
      } else {
        log(`  ✓ ${project.title} (status: ${status}) — not on Kicktraq (expected)`, "dim");
      }
    }
  }

  // Errors
  if (results.errors.length > 0) {
    log("\n" + "─".repeat(70), "bold");
    log("  ERRORS", "red");
    log("─".repeat(70));
    for (const { project, error } of results.errors) {
      log(`  ✗ ${project.title}: ${error}`, "red");
    }
  }

  // Verbose: show matched projects
  if (VERBOSE && results.matched.length > 0) {
    log("\n" + "─".repeat(70), "bold");
    log(`  MATCHED PROJECTS (${results.matched.length})`, "green");
    log("─".repeat(70));
    for (const { project, kicktraqInfo, ourStatus } of results.matched) {
      const days = kicktraqInfo.daysLeft !== null ? `${kicktraqInfo.daysLeft}d` : "N/A";
      log(`  ✓ ${project.title} — ${ourStatus} (Kicktraq: ${days} left)`, "green");
    }
  }

  // Fix mode
  if (FIX_MODE && results.mismatches.length > 0) {
    log("\n" + "─".repeat(70), "bold");
    log("  FIX MODE — Would apply the following changes:", "yellow");
    log("─".repeat(70));
    for (const { project, comparison } of results.mismatches) {
      if (comparison.suggestedFix) {
        log(`  ${project.title}: ${JSON.stringify(comparison.suggestedFix)}`, "yellow");
      }
    }
    log("\n  No automatic fixes available yet. Manual review required.", "dim");
  }

  log("\n" + "=".repeat(70), "bold");
  log("  DONE", "bold");
  log("=".repeat(70) + "\n", "bold");
}

main().catch((e) => {
  log(`FATAL: ${e.message}`, "red");
  log(e.stack, "dim");
  process.exit(1);
});
