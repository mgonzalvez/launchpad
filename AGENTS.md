# AGENTS.md

## Git
- Branch: `main`, remote: `origin/main`
- `.gitignore` excludes `AGENTS.md`, `CONTEXT.md`, `GOOGLE_SHEETS_GITHUB_SYNC_PLAN.md`, `.pi/`, `voice-samples/`, `new/` — these are local/dev-only. `blog/` is commented out (not ignored).
- `uploads/` is NOT in `.gitignore` — files must be tracked. A `pre-commit` hook auto-stages all files in `uploads/` so new images are included in every commit without manual `git add`.

## Project Overview
Static HTML/CSS/JS site for curated print-and-play board game crowdfunding projects. No build step, no npm, no frameworks. Hosted on GitHub Pages with custom domain `launchpad.gonzhome.us` (set via `CNAME`).

Local/dev-only files (in `.gitignore`): `AGENTS.md`, `CONTEXT.md`, `GOOGLE_SHEETS_GITHUB_SYNC_PLAN.md`, `.pi/` (Pi agent settings), `voice-samples/`, `new/`. Root-level markdown files like `social-blurb-collage-july-2026.md` and `new pnp projects july 2026.md` are also local-only.

All pages share `assets/app.js` (core logic + DOM utilities) and `assets/search.js` (client-side search), both exported via `window.PNPL`. Each HTML page contains inline rendering scripts that call `PNPL.loadContent()` → `PNPL.enrichProjects(data)` → render functions.

## Data Model
All content lives in `data/content.json`: `{ projects[], designers[], publishers[] }`.

- **Projects** have no manual status field — status is computed dynamically from `launchDate`/`endDate` dates via `projectStatus(p, now)`.
- **Designers/Publishers** are referenced by slug; projects link via `designer`/`publisher` string fields.
- `designers` (array) is the modern format; `designer` (string) is legacy. Both are supported. `enrichProjects()` resolves both into `designerItems[]` with slugs.

### Key project fields
| Field | Type | Notes |
|---|---|---|
| `slug` | string | Unique identifier |
| `title` | string | Display name |
| `summary` | string | 1-3 sentence description |
| `image` | string | Direct URL or `/uploads/...` local path |
| `platform` | string | Kickstarter, Gamefound, Itch.io, Crowdfunding, Store, Promo |
| `launchDate` / `endDate` | `YYYY-MM-DD` | ISO strings; empty = preview |
| `launchTime` / `endTime` | `HH:MM` | Optional time override (default: start=00:00, end=23:59) |
| `primaryUrl` | string | External project URL |
| `isPreview` | boolean | `true` = no dates announced; also inferred from empty dates |
| `isPromo` | boolean | Marks promotional listings |
| `isLatePledge` / `hasLatePledge` | boolean | Either field works |
| `latePledgeUrl` | string | Late pledge link |
| `isPreOrder` / `hasPreOrder` | boolean | Either field works |
| `preOrderUrl` | string | Pre-order link |
| `designer` | string | Legacy single designer name |
| `designers` | string[] | Modern multi-designer array |
| `publisher` | string | Publisher name |
| `imagePosition` | string | CSS position for smart image fit (e.g. `center 85%`) |
| `promoDetails` | string | Contextual promo notes |

### Enriched fields (added by `enrichProjects()`)
- `designerItems[]` — `{ name, slug }` for each designer
- `designerSlugs[]` — array of slugs
- `designerSlug` — first designer slug
- `publisherSlug` — publisher slug

### Status values (computed, never stored)
`preview` → `upcoming` → `live` → `late-pledge` / `pre-order` / `archived`
- 24h grace period after end date for timezone safety
- `promo` status when `isPromo` is true and project is live

## File Map
| File | Purpose |
|---|---|
| `index.html` | Homepage: featured carousel (5s auto-rotate), live rail, upcoming/preview compact rows |
| `live.html` | Live projects listing, sorted by end date ascending |
| `upcoming.html` | Upcoming projects listing |
| `preview.html` | Preview projects listing |
| `archive.html` | Ended, late-pledge, pre-order projects |
| `watchlist.html` | User-saved projects (localStorage) |
| `submit.html` | Project submission form (formsubmit.co email + Google Sheets webhook) |
| `designer.html` | Designer profile page |
| `publisher.html` | Publisher profile page |
| `blog/index.html` | Blog landing page |
| `blog/*.html` | Individual blog posts (static HTML) |
| `blog/*.txt` | Facebook post drafts (local-only) |
| `assets/app.js` | All shared logic, DOM utilities (`waitFor`, `safeCanvasOperation`), and rendering |
| `assets/search.js` | Client-side search module — top dropdown panel, real-time filtering, grouped by status |
| `assets/styles.css` | Complete styling |
| `assets/logo.svg` | Site logo |
| `assets/blog-collage-feb-8-15-2026.svg` | Blog collage SVG asset |
| `data/content.json` | Source of truth for all content |
| `uploads/` | Local image assets (referenced as `/uploads/...`) |

## Code Architecture (`assets/app.js`)
- Plain ES5/ES6, no modules, no frameworks. All logic in `assets/app.js`, exported via `window.PNPL`.
- **No central state object.** Functions are standalone; `content` is a module-level variable populated by `loadContent()`.

### Core Functions
- **Status:** `projectStatus(p, now)` — returns `preview`/`upcoming`/`live`/`promo`/`late-pledge`/`pre-order`/`archived`.
- **Badges:** `projectIsJustLaunched(p, now)` / `projectIsEndingSoon(p, now)` — auto-expire after launch/end day.
- **Rendering:** `projectCard(p, options)`, `projectTile(p)`, `statusBadge(status, p, now)`, `countdownChip(status, p, now)`, `header(active)`, `footer()`, `personLink(type, name, customSlug)`.
- **Data:** `enrichProjects(data)` builds lookup maps from `designers[]`/`publishers[]`. `loadContent()` fetches `data/content.json` with `Cache-Control: no-store`.
- **Sorting:** `byEndAsc` / `byLaunchDesc` / `byWeekDesc` / `byArchivePriority`.
- **Watchlist:** localStorage-backed (`pnpl_watchlist_v1`), synced across tabs via `storage` event. Functions: `readWatchlist()`, `writeWatchlist()`, `toggleWatchlist()`, `isWatchlisted()`, `clearWatchlist()`, `watchButton()`.
- **View mode:** `getViewMode(page)` / `setViewMode(mode)` — stores `full`/`compact` preference in `pnpl_view_mode_v1`, with per-page defaults defined in `PAGE_DEFAULT_VIEW`.
- **Smart Image Fit:** Canvas pixel sampling (`estimateImageTone`) sets `--img-fit`/`--img-pos` CSS vars. Managed by MutationObserver + debounced resize. Cross-origin images skipped to avoid tainted canvas.
- **Navigation:** `initSiteHeader()` — hamburger toggle, close-on-outside-click. `initContentLinkBehavior()` — card/tile clicks open `data-url` in new tab.
- **Search:** `assets/search.js` — IIFE module that uses `PNPL.waitFor('.site-header .inner', ...)` to inject a search icon into the header. On click, opens a top dropdown panel with real-time filtering. Searches project titles, summaries, designers, publishers, and platforms. Results grouped by status (Live Now, Upcoming, Preview, Ended). Designer/publisher matches link to profile pages. Top 20 results with "Show more". Recent search history in localStorage. Close via Escape, click outside, or × button. Body scroll lock when open. DOM utilities (`waitFor`, `safeCanvasOperation`) are defined in `app.js` as part of `window.PNPL`.
- **URL helpers:** `withBase(path)` — auto-detects GitHub Pages subpath from hostname; `slugify(value)` — Unicode-normalized, lowercase ASCII hyphen-separated.

### Event Flow
1. HTML page loads → `app.js` defines `PNPL.waitFor()` and `PNPL.safeCanvasOperation()` as part of `window.PNPL`
2. `app.js` module scope runs: `initContentLinkBehavior()`, `initSmartImageFitObserver()`, `initSiteHeaderObserver()`
3. `search.js` IIFE runs at module scope — uses `PNPL.waitFor('.site-header .inner', ...)` to inject search icon, loads content for indexing
4. Inline script calls `PNPL.loadContent()` → `PNPL.enrichProjects(data)` → renders via `PNPL.header()`, `PNPL.projectCard()`, `PNPL.projectTile()`
5. Status computed → badges + countdown chips rendered
6. Watchlist buttons wired → localStorage
7. Smart image fit runs on load + MutationObserver + debounced resize

### Coding Conventions
- Dates: `YYYY-MM-DD` ISO strings, validated via `hasIsoDate()`, parsed at noon local (or `launchTime`/`endTime` if provided).
- HTML via template literals + `escapeHtml()` for user content.
- CSS: `is-` prefix for state classes.
- All project images use `loading="lazy"` (except first carousel slide = `eager`).
- Cloudflare Web Analytics beacon in header (token: `15b3fbb1839542c9a2d8c7e4bf6df634`).
- Platform values: `Kickstarter`, `Gamefound`, `Itch.io`, `Crowdfunding`, `Store`, `Promo`, `Backerkit`.

## submit.html Gotchas
- Form submits via `formsubmit.co` to `mgonzalvez@gmail.com` + best-effort Google Sheets webhook (`postToGoogleSheets()` runs before `form.submit()`).
- Image URL must be a direct public `.jpg`/`.png` link — no file upload. Blocked hosts: Google Drive, Docs, Dropbox, OneDrive, iCloud, MEGA, Facebook. Also blocks itch.io `/s/NNNNN/` paths.
- Required fields: email, title, URL, designer, summary, image URL. Start/end dates required unless Preview = Yes.
- Late pledge URL required when late pledge is marked as available.
- Google Sheets webhook URL is hardcoded in `submit.html` (not in `app.js`).

## Deployment
- GitHub Actions: `.github/workflows/deploy-pages.yml` — deploys on push to `main` or manual dispatch. Uses `actions/configure-pages@v5` + `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`.
- No build step: uploads entire repo root as artifact.
- `CNAME` file sets custom domain `launchpad.gonzhome.us`.

## Editing Content
- Add/edit projects in `data/content.json` → commit → push → auto-deploy.
- Blog posts are static HTML files under `blog/` (excluded from git, local-only).
- Local images go in `uploads/` and are referenced as `/uploads/filename.ext`.
- Blog posts have corresponding `.txt` Facebook post drafts in `blog/`.
- **Adding projects:** See `docs/adding-projects.md` for a complete step-by-step guide with field reference, examples, and common pitfalls.

## Blog Posts
- Blog posts are static HTML files under `blog/` (e.g., `blog/blog-july-22-2026.html`).
- Each post follows the existing template: `blog-on-the-launchpad-*.html` or `blog-*.html` pattern.
- **Always update `blog/index.html` after creating a new blog post.** Add a new `<article class="blog-post-card blog-post-full">` block at the top of the file (before the existing entries), with the post's title, date, summary, collage image, and link to the full post. The blog index is manually maintained — it is not generated from a list.
- **Link every game to its project page on first mention.** When a game is first named in the body text (not in a parenthetical list or the live rail section), wrap the game title in an `<a href="...">` tag pointing to its Kickstarter/Gamefound/Backerkit URL. Use the `primaryUrl` from `data/content.json`. This applies to both the main body paragraphs and the bottom-line summary. Games already linked in the live rail section do not need additional links there.
- Facebook post drafts go in `blog/facebook-post-*.txt` (local-only, excluded from git).
- Collage images go in `uploads/` and are referenced as `/uploads/filename.jpg`.

## Data Guardrails
### Validation Script
- `scripts/validate-content.js` — validates `content.json` for structural integrity.
- Checks: no duplicate slugs, required fields present, image files exist, date format valid, date ordering, designer/publisher references exist in their arrays, pre-order consistency.
- Run: `node scripts/validate-content.js`
- Exit 0 = valid, exit 1 = errors found.
- Warnings (non-blocking): unknown platforms, designer/publisher not in reference arrays.

### Pre-commit Hook
- `.git/hooks/pre-commit` — runs `scripts/validate-content.js` before every commit.
- Blocks commits if validation errors are found.
- Installed automatically when the repo is cloned (copy from `scripts/pre-commit`).

### Add-Project Script
- `scripts/add-project.js` — safe way to add new projects via CLI.
- Validates all fields before writing, generates slug from title, checks for duplicates, verifies image files exist.
- Usage: `node scripts/add-project.js --title "..." --designer "..." --publisher "..." --platform Kickstarter --launchDate YYYY-MM-DD --endDate YYYY-MM-DD --image /uploads/file.jpg --primaryUrl https://...`
- Note: Projects can also be added by manually editing `content.json` (see `docs/adding-projects.md`). Always run `scripts/validate-content.js` before committing.

## Pi Coding Agent Instructions
When modifying `content.json`:
1. **Always run `node scripts/validate-content.js`** before committing.
2. **Run the pre-commit hook** — `.git/hooks/pre-commit` runs validation automatically.
3. **Verify image URLs match the project** — cross-check the Kickstarter/project URL against the image URL before committing.
4. **Check for duplicate slugs** — if a project already exists, update the existing entry instead of adding a new one.
5. **After adding/updating a project**, verify it appears in the correct status section (Upcoming, Live, Preview, etc.) by checking dates.

## Planning Docs (not implemented)
- `AUTOMATED_SUBMISSION_WORKFLOW.md` — not yet implemented (Google Sheets → content.json)
- `GOOGLE_SHEETS_GITHUB_SYNC_PLAN.md` — not yet implemented
- Note: `submit.html` submit flow is fully implemented (formsubmit.co + Google Sheets webhook). The above docs refer to automating content.json updates from submissions.

## Creating a 3x3 Image Collage
- See `docs/create-collage.md` for full instructions.
- Key: use `-resize 400x400^ -gravity center -extent 400x400` to fill each cell uniformly (not `-resize 400x400` which leaves different-sized cells).
- Group into 3 rows of 3, then stack vertically with `-append` (not all 9 at once with `+append` which makes a single row).
- No text annotations — Ghostscript is not installed. Use `.miff` for intermediates to avoid quality loss.

## Scripts
- `scripts/validate-content.js` — validates `content.json` for structural integrity.
- `scripts/add-project.js` — safe CLI tool to add new projects.
- `scripts/kicktraq-check.js` — cross-references `content.json` project statuses against Kicktraq feeds. Usage: `node scripts/kicktraq-check.js [--fix] [--verbose]`.
- `scripts/pre-commit` — pre-commit hook template (auto-installed to `.git/hooks/pre-commit`).

## Docs
- `docs/adding-projects.md` — step-by-step guide for adding projects to `content.json`
- `docs/create-collage.md` — creating 3x3 image collages with ImageMagick
- `docs/blog-workflow.md` — blog post types, structure, HTML template, and publishing workflow
- `VOICE.md` — writing voice and tone guide for blog posts (root-level)
- `assets/search.js` — client-side search module (no backend, blazing fast, grouped by status)

## Known Gaps
None currently.
