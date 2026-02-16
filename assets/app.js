const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
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

function hasIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function header(active = '') {
  const links = [
    ['', 'Home'],
    ['live.html', 'Live Now'],
    ['upcoming.html', 'Upcoming'],
    ['preview.html', 'Preview'],
    ['blog.html', 'Blog'],
    ['archive.html', 'Ended'],
    ['submit.html', 'Submit a Project']
  ];

  return `
    <header class="site-header">
      <div class="inner">
        <h1 class="brand">
          <a class="brand-link" href="${withBase('')}">
            <img class="brand-logo" src="${withBase('assets/logo.svg')}" alt="PnP Launchpad logo" />
            <span>PnP Launchpad</span>
          </a>
        </h1>
        <nav class="nav" aria-label="Primary">
          ${links.map(([href, label]) => `<a href="${withBase(href)}"${label === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
          <details class="tools-menu">
            <summary>Tools</summary>
            <div class="tools-list">
              <a href="http://pnpfinder.com" target="_blank" rel="noreferrer noopener">PnPFinder</a>
              <a href="https://formatter.gonzhome.us" target="_blank" rel="noreferrer noopener">Card Formatter</a>
              <a href="https://extractor.gonzhome.us" target="_blank" rel="noreferrer noopener">Card Extractor</a>
            </div>
          </details>
        </nav>
      </div>
    </header>
  `;
}

function footer() {
  return `<footer class="footer">Copyright 2026 by <a href="mailto:help@pnpfinder.com">Martin Gonzalvez</a>.<br />If you find this site helpful, why not buy me a coffee? <a href="https://ko-fi.com/marting" target="_blank" rel="noreferrer noopener"><span aria-hidden="true">☕</span> Buy me a coffee</a>.</footer>`;
}

function personLink(type, name, customSlug) {
  if (!name) return '';
  const slug = customSlug || slugify(name);
  const href = withBase(`${type}.html?slug=${encodeURIComponent(slug)}`);
  return `<a class="person-link" href="${href}" target="_blank" rel="noreferrer noopener">${name}</a>`;
}

function projectStatus(p, now = new Date()) {
  const isPreview = Boolean(p.isPreview) || (!hasIsoDate(p.launchDate) && !hasIsoDate(p.endDate));
  if (isPreview) return 'preview';

  const launch = parseDate(p.launchDate);
  const end = parseDate(p.endDate);
  const hasLatePledge = Boolean(p.isLatePledge || p.hasLatePledge || p.latePledgeUrl);
  if (launch > now) return 'upcoming';
  if (end < now) return hasLatePledge ? 'late-pledge' : 'archived';
  if (p.isPromo) return 'promo';
  return 'live';
}

function statusBadge(status, p = null) {
  if (status === 'live') {
    return `<a class="badge-link" href="${withBase('live.html')}"><span class="badge live-now">LIVE NOW</span></a>`;
  }
  if (status === 'upcoming') {
    return `<a class="badge-link" href="${withBase('upcoming.html')}"><span class="badge upcoming">Upcoming</span></a>`;
  }
  if (status === 'promo') {
    return `<span class="badge promo">PROMO</span>`;
  }
  if (status === 'preview') {
    return `<span class="badge preview">PREVIEW</span>`;
  }
  if (status === 'late-pledge') {
    const lpUrl = p?.latePledgeUrl ? String(p.latePledgeUrl) : withBase('archive.html');
    return `<a class="badge-link" href="${lpUrl}" target="_blank" rel="noreferrer noopener"><span class="badge late-pledge">LATE PLEDGE</span></a>`;
  }
  return `<span class="badge archived">Ended</span>`;
}

function projectCard(p) {
  const status = projectStatus(p, new Date());
  const cardUrl = status === 'late-pledge' && p.latePledgeUrl ? p.latePledgeUrl : p.primaryUrl;
  const dateMeta = status === 'preview'
    ? 'Launch: TBA | End: TBA'
    : `Launch: ${fmt.format(parseDate(p.launchDate))} | End: ${fmt.format(parseDate(p.endDate))}`;
  return `
    <article class="card card-click" data-url="${cardUrl}">
      <a href="${cardUrl}" target="_blank" rel="noreferrer noopener">
        <img src="${withBase(p.image)}" alt="${p.title}" loading="lazy" />
      </a>
      <div class="card-body">
        ${statusBadge(status, p)}
        <span class="badge">${p.platform}</span>
        <h3><a href="${cardUrl}" target="_blank" rel="noreferrer noopener">${p.title}</a></h3>
        <p>${p.summary}</p>
        <p class="meta">${dateMeta}</p>
        ${status === 'late-pledge' ? '<p class="meta"><strong>Late pledge is available.</strong></p>' : ''}
        ${status === 'preview' ? '<p class="meta"><strong>Preview listing: dates not announced yet.</strong></p>' : ''}
        ${p.designer ? `<p class="meta">Designer: ${personLink('designer', p.designer, p.designerSlug)}</p>` : ''}
        ${p.publisher ? `<p class="meta">Publisher: ${personLink('publisher', p.publisher, p.publisherSlug)}</p>` : ''}
        <a href="${cardUrl}" target="_blank" rel="noreferrer noopener">${status === 'late-pledge' ? 'Open late pledge' : 'View project'}</a>
      </div>
    </article>
  `;
}

function projectTile(p) {
  const status = projectStatus(p, new Date());
  const tileUrl = status === 'late-pledge' && p.latePledgeUrl ? p.latePledgeUrl : p.primaryUrl;
  return `
    <article class="tile tile-click" data-url="${tileUrl}">
      <a class="tile-image-link" href="${tileUrl}" target="_blank" rel="noreferrer noopener">
        <img src="${withBase(p.image)}" alt="${p.title}" loading="lazy" />
      </a>
      <div class="tile-body">
        ${statusBadge(status, p)}
        <h4><a href="${tileUrl}" target="_blank" rel="noreferrer noopener">${p.title}</a></h4>
      </div>
    </article>
  `;
}

function issueCard(issue) {
  return `
    <article class="issue-item">
      <h3><a href="${withBase(`issue.html?slug=${encodeURIComponent(issue.slug)}`)}" target="_blank" rel="noreferrer noopener">${issue.title}</a></h3>
      <p class="meta">${fmt.format(parseDate(issue.weekStart))} to ${fmt.format(parseDate(issue.weekEnd))}</p>
      <p>${issue.intro}</p>
      <a href="${withBase(`issue.html?slug=${encodeURIComponent(issue.slug)}`)}" target="_blank" rel="noreferrer noopener">View this week</a>
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
  const rank = (p) => (projectStatus(p, new Date()) === 'late-pledge' ? 0 : 1);
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
    const d = project.designer ? designerByName.get(String(project.designer).toLowerCase()) : null;
    const p = project.publisher ? publisherByName.get(String(project.publisher).toLowerCase()) : null;
    return {
      ...project,
      designerSlug: d?.slug || (project.designer ? slugify(project.designer) : ''),
      publisherSlug: p?.slug || (project.publisher ? slugify(project.publisher) : '')
    };
  });
}

function initContentLinkBehavior() {
  if (window.__pnplContentBehaviorInitialized) return;
  window.__pnplContentBehaviorInitialized = true;

  document.addEventListener('click', (event) => {
    const card = event.target.closest('.card.card-click, .tile.tile-click');
    if (!card) return;
    if (event.target.closest('a,button,input,textarea,select,label')) return;
    const url = card.getAttribute('data-url');
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

function setMainLinksNewTab(root = document) {
  const anchors = root.querySelectorAll('main a');
  anchors.forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noreferrer noopener');
  });
}

initContentLinkBehavior();

window.PNPL = {
  header,
  footer,
  projectStatus,
  projectCard,
  projectTile,
  issueCard,
  loadContent,
  byWeekDesc,
  byEndAsc,
  byLaunchDesc,
  byArchivePriority,
  parseDate,
  withBase,
  slugify,
  enrichProjects,
  setMainLinksNewTab
};
