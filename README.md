# PnP Launchpad (No Build / No npm)

PnP Launchpad is a plain static HTML/CSS/JS site for weekly curated paid Print-and-Play project digests.

## Stack

- Static files only (no build step)
- Decap CMS at `/admin/`
- JSON data source at `data/content.json`
- GitHub Pages deployment via Actions

## Structure

- `index.html` - homepage (live/upcoming + recent issues)
- `issues.html` - list of all weekly issues
- `issue.html?slug=...` - issue detail page
- `archive.html` - auto-archived projects (client-side by end date)
- `submit.html` - creator submission form (prefilled GitHub issue)
- `assets/styles.css` - theme and layout
- `assets/app.js` - shared rendering utilities
- `data/content.json` - all issues + projects
- `admin/config.yml` - Decap configuration

## Editing content

1. Open `/admin/`.
2. Edit `Site Content`.
3. Add/update issues and projects in `data/content.json`.
4. Save and publish.

Required project fields:

- `title`
- `summary`
- `image`
- `launchDate`
- `endDate`
- `primaryUrl`

## GitHub setup

1. Push repo to GitHub.
2. Replace `OWNER/REPO` in:
   - `admin/config.yml`
   - `submit.html`
   - `.github/ISSUE_TEMPLATE/config.yml`
3. In repo Settings > Pages, set source to GitHub Actions.
4. Ensure Issues are enabled.

## Decap auth note

For production Decap on GitHub Pages, configure GitHub OAuth (or a Decap-compatible auth provider).

## BGG profile auto-fill script

You can auto-fill designer/publisher BGG profile URLs and short write-ups:

```bash
python3 scripts/fetch_bgg_profiles.py --dry-run
python3 scripts/fetch_bgg_profiles.py --write
```

Options:

- `--force` refetches entries even if `bggUrl`/`bio` already exist.
- `--path` lets you target a different JSON file.
