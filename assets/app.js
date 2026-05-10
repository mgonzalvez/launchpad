const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const fmtDateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const WATCHLIST_STORAGE_KEY = 'pnpl_watchlist_v1';
const VIEW_MODE_STORAGE_KEY = 'pnpl_view_mode_v1';
const IMAGE_TONE_CACHE = new Map();

const PAGE_DEFAULT_VIEW = {
  'archive.html': 'compact',
  'live.html': 'full',
  'upcoming.html': 'full',
  'preview.html': 'full',
  'watchlist.html': 'full',
};

function getViewMode(page) {
  const urlParams = new URLSearchParams(window.location.search);
  const urlView = urlParams.get('view');
  if (urlView === 'full' || urlView === 'compact') return urlView;
  try {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === 'full' || stored === 'compact') return stored;
  } catch (_err) { /* noop */ }
  return PAGE_DEFAULT_VIEW[page] || 'full';
}

function setViewMode(mode) {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch (_err) { /* noop */ }
  const params = new URLSearchParams(window.location.search);
  params.set('view', mode);
  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, '', newUrl);
}
const basePath = (() => {
  if (window.location.hostname.endsWith('github.io')) {
    const first = window.location.pathname.split('/').filter(Boolean)[0];
    return first ? `/${first}` : '';
  }
  return '';
})();

function withBase(path = '') {
  if (/^https?:\/\//i.test(path)) return path;
  const clean = String(path).replace(/^\/+/, '');
  return clean ? `${basePath}/${clean}` : `${basePath}/`;
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseDate(value) {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      return new Date(y, mo, d, 12, 0, 0, 0);
    }
  }
  return new Date(value);
}

function parseTimeParts(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function parseProjectDateTime(dateValue, timeValue, fallback = 'midday') {
  if (!hasIsoDate(dateValue)) return new Date(dateValue);
  const m = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parts = parseTimeParts(timeValue);
  let hours = 12;
  let minutes = 0;
  if (parts) {
    hours = parts.hours;
    minutes = parts.minutes;
  } else if (fallback === 'start') {
    hours = 0;
    minutes = 0;
  } else if (fallback === 'end') {
    hours = 23;
    minutes = 59;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hours, minutes, 0, 0);
}

function hasIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayDiff(from, to) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((to.getTime() - from.getTime()) / msPerDay);
}

function atDayStart(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function atDayEnd(value) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addHours(value, hours) {
  return new Date(value.getTime() + (hours * 60 * 60 * 1000));
}

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function header(active = '') {
  const links = [
    ['', 'Home'],
    ['live.html', 'Live Now'],
    ['upcoming.html', 'Upcoming'],
    ['preview.html', 'Preview'],
    ['blog/', 'Blog'],
    ['archive.html', 'Ended'],
    ['watchlist.html', 'Watchlist'],
    ['submit.html', 'Submit a Project']
  ];

  return `
    <!-- Cloudflare Web Analytics -->
    <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"15b3fbb1839542c9a2d8c7e4bf6df634"}'></script>
    <!-- End Cloudflare Web Analytics -->
    <header class="site-header">
      <div class="inner">
        <h1 class="brand">
          <a class="brand-link" href="${withBase('')}">
            <img class="brand-logo" src="${withBase('assets/logo.svg')}" alt="PnP Launchpad logo" />
            <span>PnP Launchpad</span>
          </a>
        </h1>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav-panel" aria-label="Open navigation menu">
          <span></span>
          <span></span>
          <span></span>
        </button>
        <div class="nav-panel" id="site-nav-panel">
          <nav class="nav" aria-label="Primary">
            ${links.map(([href, label]) => `<a href="${withBase(href)}"${label === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
            <details class="tools-menu">
              <summary>Tools</summary>
              <div class="tools-list">
                <a href="http://pnpfinder.com" target="_blank" rel="noreferrer noopener">PnPFinder</a>
                <a href="https://pnptools.gonzhome.us" target="_blank" rel="noreferrer noopener">PnPTools</a>
                <a href="https://prototyper.gonzhome.us" target="_blank" rel="noreferrer noopener">Prototyper</a>
                <a href="https://formatter.gonzhome.us" target="_blank" rel="noreferrer noopener">Card Formatter</a>
                <a href="https://extractor.gonzhome.us" target="_blank" rel="noreferrer noopener">Card Extractor</a>
              </div>
            </details>
          </nav>
        </div>
      </div>
    </header>
  `;
}

function footer() {
  const tools = [
    ['http://pnpfinder.com', 'PnPFinder'],
    ['https://pnptools.gonzhome.us', 'PnPTools'],
    ['https://prototyper.gonzhome.us', 'Prototyper'],
    ['https://formatter.gonzhome.us', 'Card Formatter'],
    ['https://extractor.gonzhome.us', 'Card Extractor']
  ];
  return `
    <footer class="footer">
      <nav class="footer-tools" aria-label="Tools">
        ${tools.map(([href, label]) => `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`).join('')}
      </nav>
      <hr />
      <p>Copyright 2026 by <a href="mailto:help@pnpfinder.com">Martin Gonzalvez</a>.<br />If you find this site helpful, <a href="https://ko-fi.com/marting" target="_blank" rel="noreferrer noopener">why not buy me a coffee?</a></p>
    </footer>
  `;
}

function personLink(type, name, customSlug) {
  if (!name) return '';
  const slug = customSlug || slugify(name);
  const href = withBase(`${type}.html?slug=${encodeURIComponent(slug)}`);
  return `<a class="person-link" href="${href}" target="_blank" rel="noreferrer noopener">${escapeHtml(name)}</a>`;
}

function projectStatus(p, now = new Date()) {
  const isPreview = Boolean(p.isPreview) || (!hasIsoDate(p.launchDate) && !hasIsoDate(p.endDate));
  if (isPreview) return 'preview';

  const launch = parseProjectDateTime(p.launchDate, p.launchTime, 'start');
  // Keep projects active for an extra 24h after stated end date to avoid timezone cutoffs.
  const end = addHours(parseProjectDateTime(p.endDate, p.endTime, 'end'), 24);
  const hasLatePledge = Boolean(p.isLatePledge || p.hasLatePledge || p.latePledgeUrl);
  const hasPreOrder = Boolean(p.isPreOrder || p.hasPreOrder || p.preOrderUrl);
  if (launch > now) return 'upcoming';
  if (end < now) {
    if (hasLatePledge) return 'late-pledge';
    if (hasPreOrder) return 'pre-order';
    return 'archived';
  }
  if (p.isPromo) return 'promo';
  return 'live';
}

function projectIsJustLaunched(p, now = new Date()) {
  const status = projectStatus(p, now);
  if (!['live', 'promo'].includes(status)) return false;
  if (!hasIsoDate(p.launchDate)) return false;
  return isSameLocalDay(parseProjectDateTime(p.launchDate, p.launchTime, 'start'), now);
}

function projectIsEndingSoon(p, now = new Date()) {
  const status = projectStatus(p, now);
  if (!['live', 'promo'].includes(status)) return false;
  if (!hasIsoDate(p.endDate)) return false;
  const end = parseProjectDateTime(p.endDate, p.endTime, 'end');
  const msLeft = end.getTime() - now.getTime();
  return msLeft >= 0 && msLeft <= (24 * 60 * 60 * 1000);
}

function formatProjectDateLabel(dateValue, timeValue) {
  if (!hasIsoDate(dateValue)) return 'TBA';
  if (parseTimeParts(timeValue)) {
    return fmtDateTime.format(parseProjectDateTime(dateValue, timeValue));
  }
  return fmt.format(parseDate(dateValue));
}

function statusBadge(status, p = null, now = new Date()) {
  const launchBadge = (p && projectIsJustLaunched(p, now))
    ? '<span class="badge just-launched">JUST LAUNCHED</span>'
    : '';
  const endingSoonBadge = (p && projectIsEndingSoon(p, now))
    ? '<span class="badge ending-soon">ENDING SOON</span>'
    : '';
  if (status === 'live') {
    return `${launchBadge}<a class="badge-link" href="${withBase('live.html')}"><span class="badge live-now">LIVE NOW</span></a>${endingSoonBadge}`;
  }
  if (status === 'upcoming') {
    return `<a class="badge-link" href="${withBase('upcoming.html')}"><span class="badge upcoming">Upcoming</span></a>`;
  }
  if (status === 'promo') {
    return `${launchBadge}<span class="badge promo">PROMO</span>`;
  }
  if (status === 'preview') {
    return `<span class="badge preview">PREVIEW</span>`;
  }
  if (status === 'late-pledge') {
    const lpUrl = p?.latePledgeUrl ? String(p.latePledgeUrl) : withBase('archive.html');
    return `<a class="badge-link" href="${lpUrl}" target="_blank" rel="noreferrer noopener"><span class="badge late-pledge">LATE PLEDGE</span></a>`;
  }
  if (status === 'pre-order') {
    const poUrl = p?.preOrderUrl ? String(p.preOrderUrl) : withBase('archive.html');
    return `<a class="badge-link" href="${poUrl}" target="_blank" rel="noreferrer noopener"><span class="badge pre-order">PRE-ORDER</span></a>`;
  }
  return `<span class="badge archived">Ended</span>`;
}

function countdownChip(status, p, now = new Date()) {
  if (status === 'preview') return '<span class="countdown-chip preview">Dates TBA</span>';
  if (status === 'upcoming' && hasIsoDate(p.launchDate)) {
    const days = dayDiff(now, parseDate(p.launchDate));
    if (days <= 0) return '<span class="countdown-chip upcoming">Launching soon</span>';
    return `<span class="countdown-chip upcoming">Launches in ${days}d</span>`;
  }
  if (['live', 'promo'].includes(status) && hasIsoDate(p.endDate)) {
    const days = dayDiff(now, parseDate(p.endDate));
    if (days < 0) return '<span class="countdown-chip live">Final day</span>';
    if (days === 0) return '<span class="countdown-chip live">Ends today</span>';
    return `<span class="countdown-chip live">Ends in ${days}d</span>`;
  }
  if (status === 'pre-order') return '<span class="countdown-chip ended">Pre-order open</span>';
  return '';
}

function readWatchlist() {
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const unique = [];
    const seen = new Set();
    parsed.forEach((item) => {
      const slug = String(item || '').trim();
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      unique.push(slug);
    });
    return unique;
  } catch (_err) {
    return [];
  }
}

function writeWatchlist(slugs) {
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(slugs));
  } catch (_err) {
    // no-op when storage is unavailable
  }
}

function getWatchlistSlugs() {
  return readWatchlist();
}

function isWatchlisted(slug) {
  if (!slug) return false;
  return readWatchlist().includes(String(slug));
}

function clearWatchlist() {
  writeWatchlist([]);
}

function toggleWatchlist(slug) {
  const normalized = String(slug || '').trim();
  if (!normalized) return false;
  const slugs = readWatchlist();
  const idx = slugs.indexOf(normalized);
  if (idx >= 0) {
    slugs.splice(idx, 1);
    writeWatchlist(slugs);
    return false;
  }
  slugs.push(normalized);
  writeWatchlist(slugs);
  return true;
}

function watchButton(project, compact = false) {
  const slug = String(project?.slug || '').trim();
  if (!slug) return '';
  const active = isWatchlisted(slug);
  const label = active ? 'Remove from watchlist' : 'Save to watchlist';
  return `
    <button
      type="button"
      class="watch-btn${compact ? ' compact' : ''}${active ? ' active' : ''}"
      data-watch-slug="${slug}"
      data-watch-title="${String(project?.title || '').replace(/"/g, '&quot;')}"
      aria-pressed="${active ? 'true' : 'false'}"
      aria-label="${label}"
      title="${label}"
    >
      <span aria-hidden="true">${active ? '♥' : '♡'}</span>
      <span>${active ? 'Saved' : 'Save'}</span>
    </button>
  `;
}

function applyWatchState(button, active) {
  button.classList.toggle('active', Boolean(active));
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  const label = active ? 'Remove from watchlist' : 'Save to watchlist';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  const symbol = button.querySelector('span[aria-hidden="true"]');
  const text = button.querySelector('span:not([aria-hidden])');
  if (symbol) symbol.textContent = active ? '♥' : '♡';
  if (text) text.textContent = active ? 'Saved' : 'Save';
}

function refreshWatchButtons(slug = '') {
  const slugs = new Set(readWatchlist());
  const selector = slug ? `button[data-watch-slug="${slug}"]` : 'button[data-watch-slug]';
  document.querySelectorAll(selector).forEach((button) => {
    const buttonSlug = String(button.getAttribute('data-watch-slug') || '');
    applyWatchState(button, slugs.has(buttonSlug));
  });
}

function projectCard(p, options = {}) {
  const compact = Boolean(options.compact);
  const compactView = Boolean(options.compactView);
  const now = new Date();
  const status = projectStatus(p, now);
  const cardUrl = status === 'late-pledge' && p.latePledgeUrl
    ? p.latePledgeUrl
    : (status === 'pre-order' && p.preOrderUrl ? p.preOrderUrl : p.primaryUrl);
  const designerLinks = Array.isArray(p.designerItems) && p.designerItems.length
    ? p.designerItems.map((d) => personLink('designer', d.name, d.slug)).join(', ')
    : (p.designer ? personLink('designer', p.designer, p.designerSlug) : '');
  const dateMeta = status === 'preview'
    ? 'Launch: TBA | End: TBA'
    : `Launch: ${formatProjectDateLabel(p.launchDate, p.launchTime)} | End: ${formatProjectDateLabel(p.endDate, p.endTime)}`;
  return `
    <article class="card card-click${compact ? ' compact' : ''}${compactView ? ' compact-view' : ''}" data-url="${cardUrl}">
      <a class="smart-image-frame" href="${cardUrl}" target="_blank" rel="noreferrer noopener">
        <img src="${withBase(p.image)}" alt="${p.title}" loading="lazy" data-smart-fit${p.imagePosition ? ` data-img-pos="${String(p.imagePosition).replace(/"/g, '&quot;')}"` : ''} />
      </a>
      <div class="card-body">
        <div class="card-top-row">
          <div>
            ${statusBadge(status, p, now)}
            <span class="badge">${p.platform}</span>
          </div>
          ${watchButton(p, compactView)}
        </div>
        ${countdownChip(status, p, now)}
        <h3><a href="${cardUrl}" target="_blank" rel="noreferrer noopener">${p.title}</a></h3>
        ${compactView ? '' : `<p>${p.summary}</p>`}
        <p class="meta">${dateMeta}</p>
        ${compactView ? '' : `${status === 'late-pledge' ? '<p class="meta"><strong>Late pledge is available.</strong></p>' : ''}`}
        ${compactView ? '' : `${status === 'pre-order' ? '<p class="meta"><strong>Pre-order is available.</strong></p>' : ''}`}
        ${compactView ? '' : `${status === 'preview' ? '<p class="meta"><strong>Preview listing: dates not announced yet.</strong></p>' : ''}`}
        ${compactView ? '' : `${designerLinks ? `<p class="meta">Designer: ${designerLinks}</p>` : ''}`}
        ${compactView ? '' : `${p.publisher ? `<p class="meta">Publisher: ${personLink('publisher', p.publisher, p.publisherSlug)}</p>` : ''}`}
        <a href="${cardUrl}" target="_blank" rel="noreferrer noopener">${status === 'late-pledge' ? 'Open late pledge' : (status === 'pre-order' ? 'Open pre-order' : 'View project')}</a>
      </div>
    </article>
  `;
}

function projectTile(p) {
  const now = new Date();
  const status = projectStatus(p, now);
  const tileUrl = status === 'late-pledge' && p.latePledgeUrl
    ? p.latePledgeUrl
    : (status === 'pre-order' && p.preOrderUrl ? p.preOrderUrl : p.primaryUrl);
  return `
    <article class="tile tile-click" data-url="${tileUrl}">
      <a class="tile-image-link smart-image-frame" href="${tileUrl}" target="_blank" rel="noreferrer noopener">
        <img src="${withBase(p.image)}" alt="${p.title}" loading="lazy" data-smart-fit${p.imagePosition ? ` data-img-pos="${String(p.imagePosition).replace(/"/g, '&quot;')}"` : ''} />
      </a>
      <div class="tile-body">
        <div class="tile-top-row">
          ${statusBadge(status, p, now)}
          ${watchButton(p, true)}
        </div>
        ${countdownChip(status, p, now)}
        <h4><a href="${tileUrl}" target="_blank" rel="noreferrer noopener">${p.title}</a></h4>
      </div>
    </article>
  `;
}

async function loadContent() {
  const res = await fetch(withBase('data/content.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load content.json');
  return res.json();
}

function byWeekDesc(a, b) {
  return parseDate(b.weekStart).getTime() - parseDate(a.weekStart).getTime();
}

function byEndAsc(a, b) {
  if (!hasIsoDate(a.endDate) && !hasIsoDate(b.endDate)) return 0;
  if (!hasIsoDate(a.endDate)) return 1;
  if (!hasIsoDate(b.endDate)) return -1;
  return parseDate(a.endDate).getTime() - parseDate(b.endDate).getTime();
}

function byLaunchDesc(a, b) {
  if (!hasIsoDate(a.launchDate) && !hasIsoDate(b.launchDate)) return 0;
  if (!hasIsoDate(a.launchDate)) return 1;
  if (!hasIsoDate(b.launchDate)) return -1;
  return parseDate(b.launchDate).getTime() - parseDate(a.launchDate).getTime();
}

function byArchivePriority(a, b) {
  const rank = (p) => {
    const status = projectStatus(p, new Date());
    if (status === 'late-pledge') return 0;
    if (status === 'pre-order') return 1;
    return 2;
  };
  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) return rankDiff;
  return parseDate(b.endDate).getTime() - parseDate(a.endDate).getTime();
}

function enrichProjects(data) {
  const designers = data.designers || [];
  const publishers = data.publishers || [];

  const designerByName = new Map(designers.map((d) => [String(d.name || '').toLowerCase(), d]));
  const publisherByName = new Map(publishers.map((p) => [String(p.name || '').toLowerCase(), p]));

  return data.projects.map((project) => {
    const designerNames = Array.isArray(project.designers)
      ? project.designers.map((n) => String(n || '').trim()).filter(Boolean)
      : String(project.designer || '')
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
    const designerItems = designerNames.map((name) => {
      const match = designerByName.get(String(name).toLowerCase());
      return { name, slug: match?.slug || slugify(name) };
    });
    const d = project.designer ? designerByName.get(String(project.designer).toLowerCase()) : null;
    const p = project.publisher ? publisherByName.get(String(project.publisher).toLowerCase()) : null;
    return {
      ...project,
      designer: project.designer || designerNames.join(', '),
      designerItems,
      designerSlugs: designerItems.map((item) => item.slug),
      designerSlug: designerItems[0]?.slug || d?.slug || (project.designer ? slugify(project.designer) : ''),
      publisherSlug: p?.slug || (project.publisher ? slugify(project.publisher) : '')
    };
  });
}

function initContentLinkBehavior() {
  if (window.__pnplContentBehaviorInitialized) return;
  window.__pnplContentBehaviorInitialized = true;

  document.addEventListener('click', (event) => {
    const watchBtn = event.target.closest('button[data-watch-slug]');
    if (watchBtn) {
      event.preventDefault();
      const slug = String(watchBtn.getAttribute('data-watch-slug') || '');
      toggleWatchlist(slug);
      refreshWatchButtons(slug);
      return;
    }

    const card = event.target.closest('.card.card-click, .tile.tile-click');
    if (!card) return;
    if (event.target.closest('a,button,input,textarea,select,label')) return;
    const url = card.getAttribute('data-url');
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== WATCHLIST_STORAGE_KEY) return;
    refreshWatchButtons();
  });
}

function initSiteHeader(root = document) {
  const headers = root.querySelectorAll('.site-header');
  headers.forEach((siteHeader) => {
    if (siteHeader.dataset.navReady === '1') return;
    siteHeader.dataset.navReady = '1';

    const toggle = siteHeader.querySelector('.nav-toggle');
    const panel = siteHeader.querySelector('.nav-panel');
    const toolsMenu = siteHeader.querySelector('.tools-menu');
    if (!toggle || !panel) return;

    const closeMenu = () => {
      siteHeader.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation menu');
      if (toolsMenu) toolsMenu.removeAttribute('open');
    };

    const openMenu = () => {
      siteHeader.classList.add('nav-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close navigation menu');
    };

    toggle.addEventListener('click', () => {
      if (siteHeader.classList.contains('nav-open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    panel.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => closeMenu());
    });

    document.addEventListener('click', (event) => {
      if (!siteHeader.contains(event.target)) closeMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 980) closeMenu();
    });
  });
}

function initSiteHeaderObserver() {
  if (window.__pnplHeaderObserverInitialized) return;
  window.__pnplHeaderObserverInitialized = true;

  const rerun = () => initSiteHeader(document);
  rerun();

  const observer = new MutationObserver(() => rerun());
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function setMainLinksNewTab(root = document) {
  const anchors = root.querySelectorAll('main a');
  anchors.forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noreferrer noopener');
  });
}

function estimateImageTone(img) {
  const src = img.currentSrc || img.src || '';
  if (src && IMAGE_TONE_CACHE.has(src)) return IMAGE_TONE_CACHE.get(src);
  // Skip cross-origin images — they taint the canvas
  if (img.crossOrigin !== 'anonymous') return '';
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';
    const w = 8;
    const h = 8;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const px = w * h;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const tone = `rgb(${Math.round(r / px)}, ${Math.round(g / px)}, ${Math.round(b / px)})`;
    if (src) IMAGE_TONE_CACHE.set(src, tone);
    return tone;
  } catch (_err) {
    return '';
  }
}

function applySmartImageFit(root = document) {
  const images = root.querySelectorAll('img[data-smart-fit]');
  images.forEach((img) => {
    const updateFit = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const frame = img.getBoundingClientRect();
      if (!frame.width || !frame.height) return;

      const frameRatio = frame.width / frame.height;
      const imageRatio = img.naturalWidth / img.naturalHeight;
      // Prefer full-bleed coverage; only fall back to contain for extreme aspect mismatches.
      const ratioDelta = Math.abs(imageRatio - frameRatio) / frameRatio;
      const isCarouselImage = Boolean(img.closest('.carousel-slide'));
      const shouldContain = isCarouselImage ? true : (ratioDelta > 0.72);
      const frameEl = img.closest('.smart-image-frame');
      const preferredPos = String(img.getAttribute('data-img-pos') || '').trim();

      img.style.setProperty('--img-fit', shouldContain ? 'contain' : 'cover');
      img.style.setProperty('--img-pos', shouldContain ? 'center center' : (preferredPos || 'center top'));
      img.classList.toggle('smart-contain', shouldContain);

      if (frameEl) {
        let backdrop = frameEl.querySelector('.smart-image-backdrop');
        if (!backdrop) {
          backdrop = document.createElement('span');
          backdrop.className = 'smart-image-backdrop';
          frameEl.prepend(backdrop);
        }
        if (shouldContain) {
          const url = img.currentSrc || img.src;
          backdrop.style.backgroundImage = `url("${url}")`;
          frameEl.classList.add('has-backdrop');
        } else {
          frameEl.classList.remove('has-backdrop');
        }

        if (isCarouselImage) {
          const tone = estimateImageTone(img);
          frameEl.style.backgroundColor = tone || '#2a2a2a';
        }
      }
    };

    if (img.complete) {
      updateFit();
    } else if (!img.dataset.smartFitBound) {
      img.dataset.smartFitBound = '1';
      img.addEventListener('load', updateFit, { once: true });
      img.addEventListener('error', () => {}, { once: true });
    }
  });
}

function initSmartImageFitObserver() {
  if (window.__pnplSmartFitInitialized) return;
  window.__pnplSmartFitInitialized = true;

  const rerun = () => applySmartImageFit(document);
  rerun();

  const observer = new MutationObserver(() => rerun());
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rerun, 120);
  });
}

initContentLinkBehavior();
initSmartImageFitObserver();
initSiteHeaderObserver();

window.PNPL = {
  header,
  footer,
  projectStatus,
  projectIsJustLaunched,
  projectIsEndingSoon,
  projectCard,
  projectTile,
  loadContent,
  byWeekDesc,
  byEndAsc,
  byLaunchDesc,
  byArchivePriority,
  parseDate,
  withBase,
  slugify,
  enrichProjects,
  setMainLinksNewTab,
  applySmartImageFit,
  initSiteHeader,
  initSiteHeaderObserver,
  getWatchlistSlugs,
  clearWatchlist,
  refreshWatchButtons,
  getViewMode,
  setViewMode
};
