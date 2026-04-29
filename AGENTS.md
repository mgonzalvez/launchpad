# AGENTS.md

## Git
- Branch: `main`, remote: `origin/main`
- `.gitignore` excludes `AGENTS.md`, `blog/`, `voice-samples/`, `new/`, `GOOGLE_SHEETS_GITHUB_SYNC_PLAN.md` — these are local/dev-only and should not be committed.

## Project Overview
Static HTML/CSS/JS site for curated print-and-play board game crowdfunding projects. No build step, no npm, no frameworks. Hosted on GitHub Pages with custom domain `launchpad.gonzhome.us` (set via `CNAME`).

## Data Model
All content lives in `data/content.json`: `{ projects[], designers[], publishers[] }`.
- **Projects** have no manual status field — status is computed dynamically from `launchDate`/`endDate` dates.
- **Designers/Publishers** are referenced by slug; projects link via `designer`/`publisher` string fields.
- Key project fields: `slug`, `title`, `summary`, `image`, `platform`, `launchDate`, `endDate`, `primaryUrl`, `isPreview`, `isPromo`, `isLatePledge`, `latePledgeUrl`, `designer`, `publisher`, `imagePosition`.

## File Map
| File | Purpose |
|---|---|
| `index.html` | Homepage: featured carousel, live rail, upcoming/preview sections |
| `live.html` | Live projects listing |
| `upcoming.html` | Upcoming projects listing |
| `preview.html` | Preview projects listing |
| `archive.html` | Ended, late-pledge, pre-order projects |
| `watchlist.html` | User-saved projects (localStorage) |
| `submit.html` | Project submission form (formsubmit.co email + Google Sheets webhook) |
| `designer.html` | Designer profile page |
| `publisher.html` | Publisher profile page |
| `blog/index.html` | Blog landing page |
| `blog/*.html` | Individual blog posts |
| `assets/app.js` | All shared logic and rendering |
| `assets/styles.css` | Complete styling |
| `uploads/` | Local image assets |

## Code Architecture (`assets/app.js`)
- Plain ES5/ES6, no modules, no frameworks. All logic in `assets/app.js`, exported via `window.PNPL`.
- **No central state object.** Functions are standalone; `content` is a module-level variable populated by `loadContent()`.

### Core Functions
- **Status:** `projectStatus(p, now)` returns `preview`/`upcoming`/`live`/`promo`/`late-pledge`/`pre-order`/`archived`. 24h grace period after end date for timezone safety.
- **Badges:** `projectIsJustLaunched(p, now)` / `projectIsEndingSoon(p, now)` — auto-expire after launch/end day.
- **Rendering:** `projectCard(p, options)`, `projectTile(p)`, `statusBadge(status, p, now)`, `countdownChip(status, p, now)`, `issueCard(issue)`, `header(active)`, `footer()`, `personLink(type, name, customSlug)`.
- **Data:** `enrichProjects(data)` builds lookup maps from `designers[]`/`publishers[]` for multi-designer support. `loadContent()` fetches `data/content.json` with `Cache-Control: no-store`.
- **Sorting:** `byEndAsc` / `byLaunchDesc` / `byWeekDesc` / `byArchivePriority`.
- **Watchlist:** localStorage-backed (`pnpl_watchlist_v1`), synced across tabs via `storage` event. Functions: `readWatchlist()`, `writeWatchlist()`, `toggleWatchlist()`, `isWatchlisted()`, `clearWatchlist()`, `watchButton()`.
- **Smart Image Fit:** Canvas pixel sampling (`estimateImageTone`) sets `--img-fit`/`--img-pos` CSS vars for carousel backdrops. Managed by MutationObserver + debounced resize.
- **Navigation:** `initSiteHeader()` — hamburger toggle, close-on-outside-click. `initContentLinkBehavior()` — card/tile clicks open `data-url` in new tab.
- **URL helpers:** `withBase(path)` — prepends GitHub Pages subpath; `slugify(value)` — lowercase ASCII hyphen-separated.

### Event Flow
1. Page loads → `initContentLinkBehavior()`, `initSmartImageFitObserver()`, `initSiteHeaderObserver()`
2. `PNPL.loadContent()` → `enrichProjects()` → render via `projectCard()`/`projectTile()`
3. Status computed → badges + countdown chips rendered
4. Watchlist buttons wired → localStorage
5. Smart image fit runs on load + MutationObserver + debounced resize

### Coding Conventions
- Dates: `YYYY-MM-DD` ISO strings, validated via `hasIsoDate()`, parsed at noon local.
- HTML via template literals + `escapeHtml()` for user content.
- CSS: `is-` prefix for state classes.
- All project images use `loading="lazy"`.
- Cloudflare Web Analytics beacon in header.

## submit.html Gotchas
- Form submits via `formsubmit.co` email + best-effort Google Sheets webhook logging.
- Image URL must be a direct public `.jpg`/`.png` link — no file upload. Blocked hosts: Google Drive, Docs, Dropbox, OneDrive, iCloud, MEGA, Facebook.
- Required fields: email, title, URL, designer, summary, image URL. Start/end dates required unless Preview = Yes. Late pledge URL required when late pledge is marked available.

## Deployment
- GitHub Actions workflow: `.github/workflows/deploy-pages.yml` — deploys on push to `main` or manual dispatch. Uses `actions/configure-pages@v5` + `actions/upload-pages-artifact@v3` + `actions/deployment-pages@v4`.
- No build step: uploads entire repo root as artifact.

## Planning Docs (not implemented)
- `AUTOMATED_SUBMISSION_WORKFLOW.md` — proposed future workflow for automated project intake via Google Sheets + GitHub Actions. Not yet implemented.
- `GOOGLE_SHEETS_GITHUB_SYNC_PLAN.md` — detailed sync plan for converting approved Google Sheet rows into `data/content.json`. Not yet implemented.
