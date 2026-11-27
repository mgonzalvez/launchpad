# Status check — keeping site status in sync with reality

`scripts/status-check.js` audits every project the site currently shows as
**live**, **upcoming** or **preview**, resolves what the campaign is actually
doing, and reports (optionally applies) the smallest correction.

It exists because the site derives status from `launchDate` / `endDate`
(see `assets/app.js` → `projectStatus()`), and those dates go stale: campaigns
launch earlier than announced, run longer than expected, end early, or never
launch at all.

## How it works

For each project it builds a **source chain** and stops at the first source
that gives a usable answer:

1. **Locally saved pages** — anything in `upstream/` or `new/` whose `og:url`
   matches the project's `primaryUrl`. Free, instant, and the most accurate
   thing you can give it (this is the same input `ingest-upstream.js` uses).
2. **Kicktraq** — for Kickstarter campaigns. Not bot-blocked from this machine,
   and it gives exact launch/end datetimes, funding state (`Status: Active`,
   `Funding Successful`), days left, and backers.
3. **Direct fetch** of the campaign page (Gamefound, Backerkit, itch.io,
   stores) — usually Cloudflare-challenged from this network, so it often
   falls through.
4. **Wayback Machine** — the closest snapshot of the campaign page, used only
   if it is less than 30 days old. Gamefound pages embed
   `campaignStart` / `campaignEnd` / `backersCount` in their inline JSON;
   Kickstarter pages embed `project_deadline` / `project_launched_at` / `state`.

Everything fetched is cached in `.cache/status-check/` (default TTL 6 hours),
so a second run the same day finishes in a couple of seconds. A cold run of the
62 live/upcoming/preview projects takes roughly 1–2 minutes (Kickstarter and
Gamefound are slow from here), with requests running in parallel (default 8 at
a time) and a per-host politeness delay (200 ms for Kicktraq, 250 ms for
archive.org).

## Status semantics

The script uses **the same status logic as the site**, ported from
`assets/app.js`: preview → upcoming → live → late-pledge / pre-order /
archived, including the 24-hour grace period after the end date. A campaign
that closed yesterday is therefore *not* a mismatch — it is the grace window
doing its job.

Findings are graded:

| Kind | Meaning | Action taken |
|---|---|---|
| `ok` | site status matches the campaign | none |
| `drift` | status is right but the launch/end date is off | update the date |
| `mismatch` | status is wrong (preview but live, live but ended, archived but live) | set dates, `isPreview`, `isArchived` |
| `unverified` | no source reachable (Kickstarter previews Kicktraq does not track, bot-blocked pages) | none — needs a human |

Only changes from sources at or above `--min-confidence` (default `medium`)
are applied. Kicktraq = high, Wayback = medium.

Date drift thresholds: 1 day for Kicktraq-sourced dates (they are the
campaign's own calendar dates), 2 days for Wayback timestamps, which are UTC
and can land on the neighbouring calendar day.

## Usage

```bash
node scripts/status-check.js                     # dry run: report only
node scripts/status-check.js --fix               # apply corrections to data/content.json
node scripts/status-check.js --verbose           # also show confirmed-OK projects
node scripts/status-check.js --quiet             # findings + summary only (good for cron/CI)
node scripts/status-check.js --status=live       # only live projects
node scripts/status-check.js --all               # every project, including archived
node scripts/status-check.js --project=kardums-fate
node scripts/status-check.js --out data/status-report.json
node scripts/status-check.js --no-cache --concurrency=8
node scripts/status-check.js --data=/tmp/copy.json --fix   # rehearse on a copy
```

Exit codes: `0` = nothing to change (or changes applied), `1` = deviations
found in a dry run. That makes it usable as a scheduled job.

With `--fix` the pre-change file is backed up to
`.cache/status-check/content-backup-<timestamp>.json`, so a bad run is
recoverable. Always run `node scripts/validate-content.js` afterwards.

## What it will not do

- It never deletes a project, and it never touches images, URLs, designers or
  summaries — only `launchDate`, `endDate`, `isPreview` and `isArchived`.
- It does not invent dates. If a source cannot prove an end date, it sets
  `isArchived: true` (the documented override for campaigns that closed
  earlier than the date math implies) and says so in the report.
- It does not verify late-pledge or pre-order links; it flags them for a human.

## Routine

Run it once a week (or before a blog post) and pipe the JSON to a diff:

```bash
node scripts/status-check.js --out .cache/status-check/report.json --quiet
```

For the ~30 preview campaigns that Kicktraq does not track, save the campaign
page in the browser (`Save Page As…` into `upstream/`) and rerun — the script
reads those first, so no network is needed for them. See
[project-lookup.md](project-lookup.md).
