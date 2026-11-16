# UI Improvement Plan

Audit date: 2026-11-16. Scope: visual system, IA, UX, robustness.
Reference: the shared "Gonzhome design system" used by tokenmaker, boardsplitter,
dicemaker, prototyper and the gonzhome hub (token-based CSS, soft layered shadows,
1px borders, system fonts, light/dark theme).

Each stage is small, independently shippable, and verified by
`node scripts/ui-check.js` (static checks: tokens, legacy-color removal,
page bootstrap, toggle wiring) and `node scripts/ui-smoke.js` (headless
chromium CDP: render, toggle, persistence — skips gracefully without
chromium), plus the manual checklist listed under the stage.
Run `node scripts/validate-content.js` before every commit that touches
`data/content.json`.

## Stage 1 — Shared design tokens (DONE)

Swap the cardstock visual system for the family design system.

- `assets/styles.css`:
  - Remove the render-blocking Google Fonts `@import` (Baloo 2 + Source Sans 3)
    → system-ui font stack.
  - Replace the warm cream `:root` tokens with the family light tokens
    (`--bg: #f4f7fb`, `--panel: rgba(255,255,255,0.78)`, `--accent: #1769ff`,
    soft `--shadow-card`, 1px `--line`, radius scale 10/13/18/26).
  - Replace all hard offset shadows (`0 8px 0 #dfd2b2` etc.) with soft shadows.
  - Replace `2px solid` card/hero/panel borders with `1px`.
  - Status colors (badges, countdown chips, notices, search badges, watch
    button, launch alert) moved to per-theme tokens so both themes adapt.
- Verification: `node scripts/ui-check.js` (asserts old warm colors are gone,
  family tokens present, braces balanced).

Manual: load index + live + archive in a browser; check hero, cards, badges,
carousel, tile strip, search overlay, forms all render cleanly.

## Stage 2 — Dark mode + theme toggle (DONE)

- Inline head script in all 10 pages sets `html[data-theme]` before first
  paint (localStorage `pnpl_theme_v1`, falls back to
  `prefers-color-scheme`; default light). No FOUC.
- Sun/moon toggle button in `PNPL.header()` (`assets/app.js`), wired via
  document-level click delegation (`data-theme-toggle`) — works on every page
  without per-page wiring, matching the existing `data-watch-slug` pattern.
- Dark tokens mirror tokenmaker's dark theme (`--bg: #090b10`,
  `--accent: #6592ff`, dark surfaces/borders).
- Verification: `node scripts/ui-check.js` (asserts bootstrap script present
  and ordered before the stylesheet in every page; toggle markup + storage
  key present in app.js).

Manual: toggle both themes on home, live, archive, submit, blog; check badge
contrast, search overlay, forms, carousel. Reload persists choice.

## Stage 3 — Header/nav streamlining

- `submit.html` link → primary CTA button in header (drop duplication with
  the hero CTA); remove from pill nav.
- Watchlist → icon button with live count badge (data already in
  `pnpl_watchlist_v1`).
- Rename "Ended" → "Archive" (nav + page title + `aria-current`).
- Tools menu (header + footer) is stale: add BoardSplitter, TokenMaker,
  DiceMaker; verify all gonzhome links resolve.

## Stage 4 — Home page tightening

- Hero: cut the welcome paragraph to one sentence + CTA.
- Carousel: pause auto-rotation on hover, respect `prefers-reduced-motion`,
  add `aria-roledescription="carousel"` + polite live region, expand dot
  touch targets to ≥44px (padded hit area).
- Upcoming/Preview home rows: add scroll handles (or switch to 2×2 grids) —
  currently hidden-scrollbar scroll with no affordance.
- Gate badge keyframe animations (pulse-live, shimmer-preview, pulse-late,
  pulse-launch) behind `prefers-reduced-motion`.

## Stage 5 — Image robustness

- `content.json` hotlinks signed `i.kickstarter.com` URLs (`sig=`/`v=`
  params) that **expire** → 404s over time. Download images into `uploads/`
  for live + launch-wave projects and point `image` at local files. (git
  add/upload SOP applies.)
- `.card img`: drop the `min-height` + `aspect-ratio` conflict (use
  aspect-ratio only).
- Image placeholder gradient already tokenized — verify under both themes.

## Stage 6 — Accessibility details

- Search overlay: focus trap while open, restore focus to trigger on close.
- Carousel dots / tile handles: ≥44px touch targets.
- Contrast pass on both themes (badges, muted text, links).

## Stage 7 — SEO/meta

- `meta description` + OG tags on all pages (only index.html has them).
- `meta name="theme-color"` per theme (gonzhome pattern).
- Canonical URLs.
