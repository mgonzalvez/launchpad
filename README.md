# PnP Launchpad

Static HTML/CSS/JS site for curated print-and-play crowdfunding, promo, preview, and late-pledge projects.

## Current Status

- No build step, no npm.
- Data-driven from `data/content.json`.
- Blog is organized under `blog/` (`blog/index.html` is the blog landing page).
- Designed for GitHub Pages-style static hosting.

## Core Features

- Automatic project status from dates:
  - `Live Now`
  - `Upcoming`
  - `Preview` (no dates)
  - `Ended`
  - `Late Pledge`
- `Just Launched` treatment:
  - Launch-day badge (`JUST LAUNCHED`)
  - Temporary launch spotlight on `index.html` and `live.html`
  - Automatically expires after launch day
- Homepage:
  - Featured carousel
  - Live rail
  - Compact single-row Upcoming and Preview sections with `More` links
- Local watchlist:
  - Save/remove projects via `localStorage`
  - Dedicated `watchlist.html`
- Blog:
  - Main feed at `blog/index.html`
  - Individual posts in `blog/`
  - Dynamic "days left" counters in launch/roundup posts
- Submit flow:
  - `submit.html` includes required-field validation
  - Supports image URL or image upload
  - Includes preview and late-pledge options

## Project Structure

- `index.html` - homepage
- `live.html` - live projects
- `upcoming.html` - upcoming projects
- `preview.html` - preview projects
- `archive.html` - ended and late-pledge projects
- `watchlist.html` - local saved projects
- `submit.html` - project submission form
- `blog/index.html` - blog landing page
- `blog/*.html` - blog posts
- `designer.html` - designer profile page
- `publisher.html` - publisher profile page
- `assets/app.js` - shared logic/rendering
- `assets/styles.css` - styling
- `data/content.json` - projects + designer/publisher profiles
- `uploads/` - local image assets
- `scripts/` - optional helper scripts for extraction/profile updates

## Editing Content

Update `data/content.json` directly:

- Add/edit projects in `projects[]`
- Add/edit people in `designers[]` and `publishers[]`

Important project fields:

- `slug`
- `title`
- `summary`
- `image`
- `platform`
- `launchDate`
- `endDate`
- `primaryUrl`
- Optional: `isPreview`, `isPromo`, `isLatePledge`, `latePledgeUrl`, `designer`, `publisher`, `imagePosition`

## Notes

- Blog nav uses `/blog/` (folder index), not `blog.html`.
- Date logic is day-based (start/end of local day) for status transitions.
