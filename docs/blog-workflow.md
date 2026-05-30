# Blog Post Workflow

This document guides the creation of blog posts for PnP Launchpad. It covers post types, structure, voice, HTML template, and the full publishing workflow.

---

## Post Types

There are four recurring blog post types. Each serves a different purpose and has a slightly different structure.

### 1. Weekly Roundup — "What's New on the Launchpad"

**Purpose:** Highlight new additions and changes since the last post. The most common post type (weekly cadence).

**Structure:**
- **Opening paragraph:** Strong hook stating what changed (e.g., "Five new projects went live today") with a bold lead sentence.
- **Spotlight paragraphs:** One paragraph per notable new project, each starting with `**Project Name from Publisher**` — describe mechanics, platform, end date. Pick 3–5 standouts to give real detail.
- **Live rail summary:** One paragraph listing all currently live campaigns with end dates and brief context.
- **Closed projects:** Note any projects that ended since the last post.
- **Bottom line:** A decisive closing paragraph with a recommendation or takeaway.

**Title pattern:** `What's New on the Launchpad, [Date]` or `What's New on the Launchpad, [Date Range]`

**File naming:** `blog-on-the-launchpad-YYYY-MM-DD.html` (add suffix like `-13` if date range spans a week)

**Examples:** `blog-on-the-launchpad-2026-05-05.html`, `blog-on-the-launchpad-2026-04-30.html`

### 2. Facebook Group Roundup

**Purpose:** Curate projects mentioned in the PnP Hideaway Facebook group's weekly self-promotion thread. Cross-references against the Launchpad.

**Structure:**
- **Opening paragraph:** Context about the Facebook group activity, how many projects found, what stages they span.
- **Project entries:** One paragraph per project, organized by status (live, upcoming, preview, late-pledge). Each entry starts with `**[Project Link](url) by Designer — Platform, status.**` followed by a description and any group-specific context (countdown reminders, bonus announcements, etc.).
- **Gaps:** Note any projects mentioned in the group that are NOT yet on the Launchpad.
- **Bottom line:** Brief takeaway.

**Title pattern:** `PnP Projects from the Facebook Group, [Date]`

**File naming:** `facebook-roundup-[date-slug].html`

**Examples:** `facebook-roundup-may-21-2026.html`

### 3. Launch Alert

**Purpose:** Quick spotlight on a single project that just went live. Shorter than a roundup.

**Structure:**
- **Opening:** `**Launch alert:**` with project name and platform link.
- **Why it stands out:** One paragraph on what makes the game interesting mechanically.
- **Why back now:** Campaign urgency (days left, early momentum).
- **Days-left counter:** Use `<span class="days-left" data-end-date="YYYY-MM-DD">` for dynamic countdown.

**Title pattern:** `[Project Name] Just Launched`

**File naming:** `blog-[short-slug]-YYYY-MM-DD.html`

**Examples:** `blog-essence-launch-2026-02-17.html`

### 4. Curated Roundup / Editorial

**Purpose:** Thematic or analytical piece — records, trends, recommendations. More editorial freedom.

**Structure:**
- **Opening:** Strong opinion or observation (e.g., "18 projects live at once — that's a record").
- **Analysis paragraphs:** Group by theme, genre, urgency, or platform. Use bold lead sentences.
- **Full listing:** When relevant, link out all projects in the category.
- **Context/analysis:** What's driving the trend, what it means for the PnP ecosystem.
- **Bottom line:** Decisive closing.

**Title pattern:** Descriptive, opinionated headline

**File naming:** `blog-[short-slug]-YYYY-MM-DD.html`

**Examples:** `blog-18-live-projects-2026-05-10.html`, `blog-pnp-projects-and-promos-to-note-2026-02-20.html`

---

## Voice

Follow `VOICE.md` for the full guide. Quick reference:

- Write in first person, like an enthusiastic hobbyist talking to fellow players
- Open with a strong opinion or practical observation — no generic scene-setting
- Praise is specific (explain *what* makes it fun, not just "it's good")
- Use bold lead sentences to start paragraphs (`**This is the standout...**`)
- Light humor, parenthetical asides, occasional exaggeration — no internet snark
- End decisively with a "Bottom line:" paragraph
- Avoid hedge words ("perhaps," "arguably," "seems to") and fake neutrality

---

## HTML Template

Every blog post is a standalone HTML file in `blog/`. It follows this structure:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="../assets/logo.svg" />
    <link rel="shortcut icon" href="../assets/logo.svg" />
    <title>[Post Title] | PnP Launchpad</title>
    <link rel="stylesheet" href="../assets/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="../assets/app.js"></script>
    <script src="../assets/search.js"></script>
    <script>
      const el = document.getElementById('app');
      el.innerHTML = `
        ${PNPL.header('Blog')}
        <main>
          <article class="blog-post-card blog-post-full">
            <img class="blog-cover" src="../uploads/[collage-image.jpg]" alt="[descriptive alt text]" loading="lazy" />
            <div class="blog-post-body">
              <p class="meta">Published: [Month DD, YYYY]</p>
              <h1>[Post Title]</h1>

              <!-- Body paragraphs here -->

              <p><a href="index.html">Back to Blog</a></p>
            </div>
          </article>
        </main>
        ${PNPL.footer()}
      `;
      // Days-left counters (include only if post uses them)
      document.querySelectorAll('.days-left[data-end-date]').forEach((node) => {
        const iso = String(node.getAttribute('data-end-date') || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
        const now = new Date();
        const end = new Date(`${iso}T23:59:59`);
        const days = Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        if (days < 0) {
          node.textContent = 'ended';
        } else if (days === 0) {
          node.textContent = 'ends today';
        } else if (days === 1) {
          node.textContent = '1 day left';
        } else {
          node.textContent = `${days} days left`;
        }
      });
      PNPL.setMainLinksNewTab();
    </script>
  </body>
</html>
```

**Key conventions:**
- `PNPL.header('Blog')` — passes 'Blog' as active nav section
- `PNPL.footer()` — renders site footer
- `PNPL.setMainLinksNewTab()` — opens external links in new tabs
- Image `src` uses `../uploads/` for local files, full URLs for external
- Add `?v=YYYYMMDDa` cache-busting query string to collage images
- Days-left counters use `<span class="days-left" data-end-date="YYYY-MM-DD">` — the JS block at the bottom computes the value

---

## Blog Index (`blog/index.html`)

The index page shows posts in two tiers:

### Featured posts (full cards)
- Top 2–3 most recent posts get `blog-post-full` treatment with cover image, meta date, title, summary paragraph, and "Read the full post" link
- These are hand-picked, not automatic

### Older posts (collapsed cards)
- Under an `<h2>Older Posts</h2>` heading inside a `<section class="blog-feed">`
- Compact cards with cover image, meta date, and title link only
- No summary paragraph

**When adding a new post to the index:**
1. Add the new post as a full card at the top
2. Push the previous top full card(s) down — keep 2–3 full cards max
3. Move any overflow into the "Older Posts" section
4. Update the collage image path and alt text

---

## Facebook Post Draft

Every blog post should have a companion `.txt` file in `blog/` for the Facebook group post.

**File naming:** `facebook-post-[date-slug].txt`

**Structure:**
- Casual, emoji-friendly tone (looser than the blog post)
- List projects with emojis, one-liner descriptions, links
- End with a link to the full blog post
- Include relevant hashtags: `#PnP #BoardGames #Kickstarter #Gamefound #PrintAndPlay`

**The Facebook post goes in the PnP Hideaway group's weekly self-promotion thread.**

---

## Image / Collage

Most posts include a cover image — typically a 3x3 collage of project artwork.

- Build collages with ImageMagick (see `docs/create-collage.md`)
- Save to `uploads/` with descriptive names like `blog-collage-2026-05-05.jpg`
- Use `?v=YYYYMMDDa` query string in the `src` to bust cache on updates
- Write descriptive `alt` text listing the projects shown

For launch alerts, a single project cover image is fine.

---

## Publishing Workflow

1. **Gather content** — check `data/content.json` for current projects, their dates, and status
2. **Choose post type** — based on what's happening (new launches? Facebook activity? a record?)
3. **Draft the post** — write in Martin's voice (see `VOICE.md`), follow the structure for the chosen type
4. **Build the collage** — create a 3x3 image collage from project artwork (see `docs/create-collage.md`)
5. **Save the HTML file** — to `blog/blog-[slug]-YYYY-MM-DD.html`
6. **Write the Facebook draft** — save as `blog/facebook-post-[date-slug].txt`
7. **Update `blog/index.html`** — add the new post as a featured card, push older posts down
8. **Commit** — blog posts are excluded from git (`.gitignore`), so these are local-only unless you choose to track them

**Note:** Blog posts are NOT committed to git by default (the `blog/` directory is commented out in `.gitignore`). They are local-only files. If you want them deployed, you need to uncomment `blog/` in `.gitignore` or add them explicitly.

---

## Quick Reference: Data Sources

- **Project data:** `data/content.json` — the source of truth for all projects, designers, publishers
- **Current live projects:** Check `launchDate`/`endDate` against today's date
- **Facebook group:** PnP Hideaway's weekly self-promotion thread (external)
- **Existing posts:** `blog/` directory — review for continuity and to avoid repeating coverage
