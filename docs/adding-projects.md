# Adding Projects to PnP Launchpad

## Overview

All project data lives in `data/content.json`. To add a new project, add an object to the `projects[]` array. The site computes project status automatically from dates — no manual status field is needed.

## Step-by-Step

### 1. Prepare the Project Object

Create a new JSON object with the following fields:

#### Required Fields

| Field | Type | Example | Notes |
|---|---|---|---|
| `slug` | string | `"my-new-game"` | Unique, lowercase, hyphenated. No spaces or special chars. |
| `title` | string | `"My New Game"` | Display name shown on the site. |
| `summary` | string | `"A short description..."` | 1-3 sentences describing the game. |
| `image` | string | See below | Direct URL or `/uploads/filename.ext` |
| `platform` | string | `"Kickstarter"` | One of: Kickstarter, Gamefound, Itch.io, Crowdfunding, Store, Promo, Backerkit, Indiegogo, Patreon, Other |
| `launchDate` | string | `"2026-06-15"` | ISO date `YYYY-MM-DD`. Use `""` for previews. |
| `endDate` | string | `"2026-07-15"` | ISO date `YYYY-MM-DD`. Use `""` for previews. |
| `primaryUrl` | string | `"https://..."` | Full URL to the campaign/store page. |

#### Optional Fields

| Field | Type | Purpose |
|---|---|---|
| `designer` | string | Single designer name (legacy format) |
| `designers` | string[] | Multiple designers (modern format, preferred) |
| `publisher` | string | Publisher name |
| `isPreview` | boolean | `true` = no dates announced yet (also inferred from empty dates) |
| `isPromo` | boolean | `true` = marks as a promotional listing |
| `isLatePledge` / `hasLatePledge` | boolean | Either field works — late pledge is available |
| `latePledgeUrl` | string | URL for late pledge backer page |
| `isPreOrder` / `hasPreOrder` | boolean | Either field works — pre-order is available |
| `preOrderUrl` | string | URL for pre-order page |
| `launchTime` / `endTime` | string | `"HH:MM"` time override (default: start=00:00, end=23:59) |
| `promoDetails` | string | Contextual notes for thread posts or blog mentions |
| `imagePosition` | string | CSS position for smart image fit (e.g. `"center 85%"`) |

### 2. Handle the Image

**Option A — Remote URL:** Use a direct link to a `.jpg` or `.png` image.

**Option B — Local file:**
1. Save the image to the `uploads/` directory
2. Reference it as `/uploads/filename.ext` in the project object
3. The `pre-commit` hook will auto-stage it — no manual `git add uploads/...` needed

### 3. Add Designer/Publisher Entries (if new)

If the designer or publisher doesn't already exist in the `designers[]` or `publishers[]` arrays, add them:

```json
{
  "slug": "new-designer-name",
  "name": "New Designer Name",
  "bggUrl": "https://boardgamegeek.com/boardgamedesigner/XXXXX/new-designer-name",
  "bio": "Optional biography text."
}
```

- `slug`: lowercase, hyphenated
- `name`: display name
- `bggUrl`: optional BoardGameGeek profile URL
- `bio`: optional bio text (HTML entities like `&amp;` are fine)

### 4. Insert into `content.json`

Add the project object to the `projects[]` array. Place it near the top (newest projects first) or at the end — the site sorts by date, not by array position.

### 5. Commit and Push

```bash
git add data/content.json
git add uploads/your-image.ext   # only if you added a local image
git commit -m "Add: My New Game"
git push origin main
```

The site auto-deploys via GitHub Actions on push to `main`.

---

## Status Computation (Automatic)

The site determines project status from dates — no manual status field:

| Status | Condition |
|---|---|
| **preview** | No dates (`launchDate`/`endDate` empty) or `isPreview: true` |
| **upcoming** | `launchDate` is in the future |
| **live** | Current date is between `launchDate` and `endDate` |
| **late-pledge** | After `endDate` with `isLatePledge: true` |
| **pre-order** | After `endDate` with `isPreOrder: true` |
| **archived** | After `endDate` with no special flags |
| **promo** | `isPromo: true` and project is live |

A 24-hour grace period after the end date provides timezone safety.

---

## Example: Adding a Kickstarter Project

```json
{
  "slug": "example-game",
  "title": "Example Game",
  "summary": "A quick card game for 2-4 players with push-your-luck mechanics.",
  "image": "https://cf.geekdo-images.com/example__original/img/abc123/pic9999999.jpg",
  "platform": "Kickstarter",
  "launchDate": "2026-06-15",
  "endDate": "2026-07-15",
  "primaryUrl": "https://www.kickstarter.com/projects/example/example-game",
  "designers": ["Jane Designer", "John Designer"],
  "publisher": "Example Publishing",
  "isLatePledge": true,
  "latePledgeUrl": "https://www.kickstarter.com/projects/example/example-game",
  "promoDetails": "New push-your-luck card game launching June 15."
}
```

## Example: Adding a Preview Project

```json
{
  "slug": "upcoming-preview",
  "title": "Upcoming Preview",
  "summary": "A mysterious new game from an indie designer. Dates TBD.",
  "image": "/uploads/upcoming-preview.png",
  "platform": "Gamefound",
  "launchDate": "",
  "endDate": "",
  "isPreview": true,
  "primaryUrl": "https://gamefound.com/en/projects/example/upcoming-preview",
  "designer": "Solo Designer",
  "promoDetails": "Submitted as a preview crowdfunding project."
}
```

---

## Common Pitfalls

- **Duplicate slugs:** Each `slug` must be unique across all projects.
- **Date format:** Must be `YYYY-MM-DD` (ISO format). No other formats are accepted.
- **Empty dates = preview:** If `launchDate` and `endDate` are both `""`, the project is treated as a preview regardless of `isPreview`.
- **Local images:** Files in `uploads/` must be tracked in git. The `pre-commit` hook auto-stages them, but if you add files outside of git commits, they won't deploy.
- **Designer/publisher name matching:** The `designer`/`publisher` string in a project must match the `name` field in the corresponding `designers[]`/`publishers[]` entry for profile links to resolve correctly.
- **JSON syntax:** Remember trailing commas are not valid JSON. Ensure the last item in any array does not have a trailing comma.

---

## Blog Posts

Blog posts live in `blog/` as static HTML files (excluded from git). Naming convention: `blog-<topic>-YYYY-MM-DD.html`.

### Checklist — every new blog post requires:

1. **Gather project data** — look up each project in `data/content.json` to get the correct title, designer, platform, dates, and `primaryUrl`.
2. **Write the HTML post** in `blog/` using `PNPL.header()` / `PNPL.footer()` for consistent layout. Link every game name to its crowdfunding URL.
3. **Create a 3x3 collage** (`uploads/blog-collage-YYYY-MM-DD.jpg`) if one doesn't already exist — see `docs/create-collage.md`. Use the same 9 projects featured in the post.
4. **Update `blog/index.html`** — add the new post as the first `<article class="blog-post-card blog-post-full">` block (before the existing latest post), with the collage image, date, title, summary paragraph, and "Read the full post" link.
5. **Write a Facebook post draft** (`blog/facebook-post-YYYY-MM-DD.txt`) for cross-promotion — emoji-formatted summary of each project with a link to the full blog post.
6. **Commit all files** — the HTML post, collage image, updated `index.html`, and the `.txt` draft.

### Notes

- Posts link to projects via their Kickstarter/Gamefound URLs — always link game names, not just the "Read the full post" CTA.
- Each post has a corresponding `.txt` Facebook post draft in `blog/`.
- Posts use template literals via `PNPL.header()` and `PNPL.footer()` for consistent layout.
- Collage images use a version query string (`?v=YYYYMMDDa`) in `index.html` to bust cache.

## Related

- `AGENTS.md` — full project architecture and code reference
- `README.md` — site overview and features
- `docs/create-collage.md` — creating 3x3 image collages for blog posts
