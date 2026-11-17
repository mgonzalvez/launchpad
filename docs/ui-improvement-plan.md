# UI Improvement Plan

Audit date: 2026-11-16. Scope: visual system, IA, UX, robustness.
Reference: the shared "Gonzhome design system" used by tokenmaker, boardsplitter,
dicemaker, prototyper and the gonzhome hub (token-based CSS, soft layered shadows,
1px borders, system fonts, light/dark theme).

Each stage is small, independently shippable, and verified by
`node scripts/ui-check.js` (static checks: tokens, legacy-color removal,
page bootstrap, toggle wiring, aria/meta coverage — 258 checks) and
`node scripts/ui-smoke.js` (headless chromium CDP: render, toggle, persistence,
carousel behaviour, search focus, broken images — skips gracefully without
chromium), plus `node scripts/contrast-check.js` (WCAG ratios for both themes).
Run `node scripts/validate-content.js` before every commit that touches
`data/content.json`.

Stages 1–7 are complete as of 2026-11-16. Remaining nice-to-haves:

- Stage 8 (unstarted): archive pagination currently loads 20 at a time with no
  "back to top"; the carousel picks featured slides randomly on each load, so a
  deterministic seed (like the family's determinism-first approach) would make
  screenshots and tests reproducible.
- Stage 9 (unstarted): `uploads/` is ~193 MB and growing; a one-off pass to
  re-encode oversized PNGs as JPEG/WebP would trim it without touching layout.

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

## Stage 3 — Header/nav streamlining (DONE)

- `submit.html` link → primary CTA button in header (drop duplication with
  the hero CTA); remove from pill nav. CTA renders in `.inner` (stays
  visible on mobile next to the hamburger) and gets `aria-current="page"`
  on the submit page itself.
- Watchlist → icon button with live count badge (data already in
  `pnpl_watchlist_v1`). `refreshWatchlistNav()` syncs the badge on watch
  toggles and `storage` events. Gotcha found here: the writes must be
  guarded — the header sits inside a MutationObserver, and an unconditional
  `textContent` write re-queues itself and spins the main thread forever
  (caught via CDP smoke test).
- Rename "Ended" → "Archive" (nav + page title + `aria-current`).
- Tools menu (header + footer) is stale: add BoardSplitter, TokenMaker,
  DiceMaker; verify all gonzhome links resolve. All 8 tool URLs verified
  HTTP 200 on 2026-11-16.
- Also fixed `submit.html`'s static header (it had no theme toggle, no
  watchlist button, and a stale tools list).
- Verification: `node scripts/ui-check.js` (static: CTA, watch badge,
  Archive label, tools-list assertions) + `node scripts/ui-smoke.js`
  (headless CDP: CTA renders, badge hidden at 0, badge live-updates on
  storage event, header + footer tools in sync).
- Smoke-test hardening: uses a throwaway `--user-data-dir` (a running user
  Chromium holds its profile's singleton lock and hung the test for 30+
  minutes), plus a 15s per-command CDP timeout and a 120s global watchdog.

## Stage 4 — Home page tightening (DONE)

- Hero: welcome paragraph cut to one sentence + the CTA.
- Carousel (`index.html`):
  - `role="region" aria-roledescription="carousel" aria-label="Featured live projects"`.
  - Polite live region (`#carousel-live`) announces "Slide n of m: Title".
  - Auto-rotation pauses on hover (`mouseenter`/`mouseleave`) and while any
    element inside the carousel has focus (`focusin`/`focusout`), and never
    starts when `prefers-reduced-motion: reduce` is set.
  - Arrow keys inside the carousel move slides (Left/Right).
  - Inactive slides get the `inert` attribute (feature-detected) so they are
    neither focusable nor in the a11y tree.
  - Dots are 44x44 buttons with the 9px dot drawn by `::after`;
    carousel arrows are 44px.
- Upcoming/Preview home rows: replaced the hidden-scrollbar row with a
  wrapping `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))` — no
  scrolling to discover content. The live tile strip keeps its handles
  (now 44px).
- Badge pulses (`pulse-live`, `pulse-late`, `pulse-launch`,
  `shimmer-preview`) and the search slide-in are declared only inside
  `@media (prefers-reduced-motion: no-preference)`; the `reduce` block also
  kills the slide/backdrop transitions and smooth scrolling.
- Tile scrolling uses `behavior: 'auto'` under reduced motion.
- Verification: `ui-check.js` (hero text, carousel aria, 44px targets, every
  `animation:` inside the motion gate) + `ui-smoke.js` (live region content,
  measured tap sizes, hover pause measured over a 5.2s window, rotation does
  not advance when chromium is emulated with `prefers-reduced-motion: reduce`,
  badge `animation-name` resolves to `none`).

## Stage 5 — Image robustness (DONE)

- New script `scripts/localize-images.js` downloads the image for every
  non-archived project into `uploads/<slug>.<ext>` and rewrites `image` to
  the local path. Run it after adding projects with hotlinked Kickstarter art.
  - `--dry-run`, `--all` (include archived), `--concurrency=6`, `--verbose`.
  - Skips files already in `uploads/`, dedupes identical URLs, and leaves the
    remote URL in place if a download fails.
  - 2026-11-16 run: 46 active images localized, 13 already present, 0 failed.
- `validate-content.js` now warns when a still-listed project points at a
  signed hotlink (`sig=`) that will expire.
- `.card img`, `.grid.compact-grid .card img` and `.card.compact img`: the
  `min-height` values are gone; aspect-ratio alone controls the geometry.
- `.tile img` and `.smart-image-frame` now use the themed `--img-placeholder`
  token instead of hardcoded warm/dark gradients.
- Verification: `ui-smoke.js` waits for all images to finish loading and fails
  if any card/tile/carousel image has `naturalWidth === 0`; it also asserts the
  home imagery is local (0 remote) and that `.card img` computes
  `aspect-ratio: 4 / 3` with no min-height.
- SOP still applies: new `uploads/` files must be `git add`'d in the same
  commit as `content.json`.

## Stage 6 — Accessibility details (DONE)

- Search overlay (`assets/search.js`):
  - Trigger button: `aria-haspopup="dialog"` + `aria-expanded` kept in sync;
    panel has `role="dialog"` and an `aria-label`.
  - Tab is trapped inside the open panel (wraps last → first and first → last
    with Shift+Tab).
  - Closing returns focus to the trigger.
  - Result rows are real `<a href>` links instead of click-handler divs, so
    they are keyboard reachable and show as links.
  - Polite status region reports "n result(s)" as the query changes.
  - Close button is 44x44; history pills are 40px tall.
- Contrast pass: `scripts/contrast-check.js` composites the translucent
  surfaces over the page background and computes WCAG ratios for every
  text/surface token pair in both themes (56 pairs, all ≥ 4.5:1 on 2026-11-16).
  It fixes the case where a border token was used as a text color
  (`.search-count` used `var(--line)`).
- Verification: `ui-check.js` (static wiring) + `ui-smoke.js` (opens search,
  checks focus lands in the input, dispatches a Tab keydown from the last
  focusable element and confirms focus wraps, clicks close and confirms focus
  returns to the trigger).

Manual remaining: eyeball badge contrast in dark mode on a phone, and confirm
the carousel pause feels right on a touch device (touch pause was already there;
hover pause is desktop-only).
