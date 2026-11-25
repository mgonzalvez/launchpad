# Getting campaign details from just a URL

## The problem

From this machine the campaign pages themselves are unreachable. Kickstarter,
Gamefound, BoardGameGeek and Reddit all sit behind Cloudflare's JS challenge,
and the egress IP here (Apple corporate, AS7018) has a bad enough reputation
that Cloudflare answers `403 "Just a moment..."` for:

- `curl`, and `curl` with full Chrome headers
- `Googlebot`, `Wget`, `python-requests` user agents
- headless Chromium (`--headless=new --dump-dom`) — it renders the challenge page
- third-party fetch proxies (`allorigins`, `codetabs`, `corsproxy.io`) — they get 520/522 from Cloudflare too
- Kickstarter's own `.json` and `/oembed` endpoints

Reachable from here: `api.github.com`, `web.archive.org` (CDX API, flaky),
`kicktraq.com`, DuckDuckGo's HTML endpoint (works, then starts returning
anomaly pages after a few queries).

So the block is **the IP, not the tool**. The same script run from a home
connection, a hotspot, or a VPS will usually just work.

## `scripts/lookup-project.js`

```bash
node scripts/lookup-project.js <url>                      # walk the fallback chain
node scripts/lookup-project.js --file saved.html          # parse a page you saved from a browser
node scripts/lookup-project.js <url> --save-wayback       # ask archive.org to crawl it, then read the snapshot
node scripts/lookup-project.js <url> --out project.json
```

Sources tried, in order:

1. **Direct fetch** — works off the corporate network.
2. **Reader proxy** — `https://r.jina.ai/<url>` if `JINA_API_KEY` is set, or
   `LOOKUP_PROXY=<your-worker>/?url=` (see below).
3. **Wayback Machine** — CDX lookup for the newest snapshot, then
   `web.archive.org/web/<ts>id_/<url>`. This is the best trick for blocked
   sites: the crawl happens on archive.org's IP, not ours. Verified working for
   Gamefound campaigns; new Kickstarter campaigns usually have no snapshot yet.
4. **DuckDuckGo HTML/lite snippets** — best-effort; useful for confirming a
   title or an "ends Nov 24, 2026" snippet, not reliable enough to trust blindly.

Extracted fields: `title`, `summary`, `image` (og:image), `platform`, `slug`,
`publisher` (from `og:title` = "X by Y"), and — when the page's inline kicker
JSON is present — `deadline`/`launched_at` → `endDate`/`launchDate`, `goal`,
`pledged`, `backers`.

The script prints the JSON plus a **"Still needs a human"** list. It never
invents a date.

## The reliable option: your own Cloudflare Worker

You already run Cloudflare for `gonzhome.us`. A 12-line Worker fetches the page
from Cloudflare's edge instead of from your laptop:

```js
// launchpad-proxy worker
export async function fetchPage(req) {
  const url = req.query.url;
  if (!url) return new Response("missing ?url=", { status: 400 });
  const r = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
```

```bash
wrangler deploy --name launchpad-proxy
export LOOKUP_PROXY="https://launchpad-proxy.<account>.workers.dev/?url="
node scripts/lookup-project.js "https://www.kickstarter.com/projects/..."
```

Free tier is 100k requests/day. Whether Kickstarter answers it is a
 coin flip — test it once before relying on it.

## Ingesting saved pages in bulk

If you save campaign pages into `upstream/` (browser → Save Page As…), the bulk
version of the lookup is:

```bash
node scripts/ingest-upstream.js                 # add every page not already in content.json
node scripts/ingest-upstream.js --dry-run       # show what it would add, write nothing
node scripts/ingest-upstream.js --verbose       # per-project detail
node scripts/ingest-upstream.js --no-images     # keep remote image URLs instead of localising
node scripts/ingest-upstream.js --dir=new       # any folder of saved .html files
```

It is idempotent (already-known projects are skipped by `primaryUrl` or slug),
converts the campaign's own launch/deadline timestamps to Pacific time, downloads
and re-encodes hero art into `uploads/<slug>.jpg` (≤1600px, q82) — the image CDN
`i.kickstarter.com` is not bot-blocked even though `www.kickstarter.com` is — and
creates missing designer/publisher profile entries. Run `validate-content.js`
afterwards and commit `data/content.json` together with the new `uploads/` files.

## Other realistic routes

- **Free r.jina.ai API key.** Anonymous jina queries are blocked by reputation;
  authenticated ones are fetched by their own infra and return clean markdown.
- **Kicktraq's JSON API** (`api.kicktraq.com/projects/<slug>?key=`) — needs a key;
  note the *HTML* pages have no dates, which is why `kicktraq-check.js` reports
  "Matched: 0" today.
- **Paste it.** The zero-failure path: open the campaign, copy the visible text
  (title, "by X", "Campaign ends Dec 17", goal, backers) or Save Page As…, then
  `node scripts/lookup-project.js --file saved.html`. A screenshot works too —
  same as the Newswire workflow.
