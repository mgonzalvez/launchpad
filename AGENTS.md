# AGENTS.md

## Git
- Branch: `main`, remote: `origin/main`
- `.gitignore` excludes: `AGENTS.md`, `CONTEXT.md`, `.pi/`, `voice-samples/`, `new/`. `blog/` is **not ignored** (the `# blog/` line is commented out — blog posts are tracked in git).
- `uploads/` is tracked, but the `pre-commit` hook only validates `content.json` — it does **not** auto-stage `uploads/`. Always `git add` new/changed image files explicitly, or they won't deploy and images will 404.

## Project Overview
Static HTML/CSS/JS site for curated print-and-play board game crowdfunding projects. No build step, no npm, no frameworks. GitHub Pages with custom domain `launchpad.gonzhome.us` (set via `CNAME`).

All pages share `assets/app.js` (core logic + DOM utilities) and `assets/search.js` (client-side search), exported via `window.PNPL`. Each HTML page has an inline script calling `PNPL.loadContent()` → `PNPL.enrichProjects(data)` → render functions.

Pages: `index.html` (home), `live.html`, `upcoming.html`, `preview.html`, `archive.html`, `watchlist.html`, `submit.html`, `designer.html`, `publisher.html`, `blog/index.html`.

## Data Model
All content in `data/content.json`: `{ projects[], designers[], publishers[] }`.

- **Projects** have no manual status field — status is computed from `launchDate`/`endDate` via `projectStatus(p, now)`.
- `designer` (string) is legacy; `designers` (string[]) is modern. `enrichProjects()` resolves both into `designerItems[]`.
- Designer/publisher names in projects must match `name` fields in `designers[]`/`publishers[]` for profile links to resolve.

### Key project fields
| Field | Type | Notes |
|---|---|---|
| `slug` | string | Unique identifier |
| `title` / `summary` | string | Display name; 1-3 sentence description |
| `image` | string | Direct URL or `/uploads/...` |
| `platform` | string | Kickstarter, Gamefound, Itch.io, Crowdfunding, Store, Promo, Backerkit |
| `launchDate` / `endDate` | `YYYY-MM-DD` | ISO; empty = preview |
| `launchTime` / `endTime` | `HH:MM` | Optional time override |
| `primaryUrl` | string | External project URL |
| `isPreview` | boolean | No dates announced |
| `isPromo` | boolean | Promotional listing |
| `isLatePledge` / `hasLatePledge` | boolean | Either works |
| `latePledgeUrl` | string | Late pledge link |
| `isPreOrder` / `hasPreOrder` | boolean | Either works |
| `preOrderUrl` | string | Pre-order link |
| `imagePosition` | string | CSS fit position (e.g. `center 85%`) |

### Status (computed, never stored)
`preview` → `upcoming` → `live` → `late-pledge` / `pre-order` / `archived` / `promo`
- 24h grace period after end date for timezone safety.

## Rendering Functions (`assets/app.js`)
- `projectCard(p, options)` — full card with badges, countdown, designer/publisher links.
- `projectTile(p)` — compact tile.
- `statusBadge(status, p, now)` / `countdownChip(status, p, now)` — auto-expiring badges.
- `projectIsJustLaunched(p, now)` / `projectIsEndingSoon(p, now)` — same-day detection.
- `personLink(type, name, customSlug)` — generates profile page links.
- `watchButton(project, compact)` — localStorage-backed watchlist (`pnpl_watchlist_v1`), synced via `storage` event.
- `getViewMode(page)` / `setViewMode(mode)` — per-page view preference (`pnpl_view_mode_v1`).- `getSortMode(page)` / `setSortMode(mode)` — per-page sort preference (`pnpl_sort_mode_v1`), also supports URL `?sort=` param.
- Sorting: `byEndAsc`, `byEndDesc`, `byLaunchAsc`, `byLaunchDesc`, `byTitleAsc`, `byTitleDesc`, `byPlatform`, `byStatusCategory`, `byWeekDesc`, `byArchivePriority`.

## submit.html Gotchas
- Submits via `formsubmit.co` to `mgonzalvez@gmail.com` + Google Sheets webhook (`postToGoogleSheets()` before `form.submit()`).
- Image URL must be a direct `.jpg`/`.png` link. Blocked hosts: Google Drive/Docs, Dropbox, OneDrive, iCloud, MEGA, Facebook, itch.io `/s/NNNNN/` paths.
- Required: email, title, URL, designer, summary, image URL. Dates required unless Preview = Yes.
- Late pledge URL required when late pledge is available.
- Webhook URL is hardcoded in `submit.html` (not in `app.js`).

## Deployment
- `.github/workflows/deploy-pages.yml` — deploys on push to `main` or manual dispatch. No build step; uploads entire repo root.
- Uses `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`.

## Blog Workflow
- Posts are static HTML in `blog/` (tracked in git). `blog/index.html` is the blog landing page.
- **Always update `blog/index.html`** after creating a new post — add a new `<article class="blog-post-card blog-post-full">` block at the top.
- **Link every game to its project page on first mention** in body text (not in parenthetical lists or live rail). Use `primaryUrl` from `content.json`.
- Facebook post drafts go in `blog/facebook-post-*.txt` (local-only).
- Collage images go in `uploads/`, referenced as `/uploads/filename.jpg`.
- See `docs/blog-workflow.md` for full structure and HTML template.

## Scripts
- `node scripts/validate-content.js` — validates `content.json`. Exit 0 = valid, 1 = errors. Run before every commit.
- `node scripts/add-project.js --title "..." --designer "..." --publisher "..." --platform Kickstarter --launchDate YYYY-MM-DD --endDate YYYY-MM-DD --image /uploads/file.jpg --primaryUrl https://...` — safe CLI for adding projects.
  - **Limitation:** platform list in this script is `Kickstarter, Indiegogo, Backerkit, Store, Patreon, Other` — it will reject `Gamefound`, `Itch.io`, `Crowdfunding`, `Promo`. For those, edit `content.json` directly.
- `node scripts/kicktraq-check.js [--fix] [--verbose]` — cross-references statuses against Kicktraq.
- Pre-commit hook: `cp scripts/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`

## Pi Agent Workflow
When modifying `content.json`:
1. Run `node scripts/validate-content.js` before committing.
2. Pre-commit hook runs validation automatically (if installed).
3. Verify image URLs match the project — cross-check project URL against image URL.
4. Check for duplicate slugs — update existing entries, don't add duplicates.
5. Verify the project appears in the correct status section by checking dates.

When creating blog posts:
1. Gather project data from `data/content.json` (title, designer, platform, dates, `primaryUrl`).
2. Write HTML using `PNPL.header('Blog')` / `PNPL.footer()` for consistent layout.
3. Build a 3x3 collage with ImageMagick if needed (`-resize 400x400^ -gravity center -extent 400x400`, group into 3 rows of 3, `-append`, use `.miff` intermediates).
4. Update `blog/index.html` manually — add as first full card.
5. Write companion `blog/facebook-post-*.txt` draft.
6. Follow `VOICE.md` for tone guidelines.

## Other Useful Docs
- `docs/adding-projects.md` — step-by-step guide for adding projects
- `docs/create-collage.md` — 3x3 image collage instructions
- `docs/blog-workflow.md` — blog post types, structure, HTML template
- `VOICE.md` — writing voice and tone guide
