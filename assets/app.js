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

function header(active = '') {
  const links = [
    ['', 'Home'],
    ['live.html', 'Live Now'],
    ['upcoming.html', 'Upcoming'],
    ['issues.html', 'This Week'],
    ['archive.html', 'Archive'],
    ['submit.html', 'Submit a Project'],
    ['admin/', 'Admin Login']
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
        </nav>
      </div>
    </header>
  `;
}

function footer() {
  return `<footer class="footer">PnP Launchpad is manually curated from creator-submitted project links. All submissions require approval before publication.</footer>`;
}

function personLink(type, name, customSlug) {
  if (!name) return '';
  const slug = customSlug || slugify(name);
  const href = withBase(`${type}.html?slug=${encodeURIComponent(slug)}`);
  return `<a class="person-link" href="${href}">${name}</a>`;
}

function projectStatus(p, now = new Date()) {
  const launch = new Date(p.launchDate);
  const end = new Date(p.endDate);
  if (launch > now) return 'upcoming';
  if (end < now) return 'archived';
  if (p.isPromo) return 'promo';
  return 'live';
}

function statusBadge(status) {
  if (status === 'live') {
    return `<a class="badge-link" href="${withBase('live.html')}"><span class="badge live-now">LIVE NOW</span></a>`;
  }
  if (status === 'upcoming') {
    return `<a class="badge-link" href="${withBase('upcoming.html')}"><span class="badge upcoming">Upcoming</span></a>`;
  }
  if (status === 'promo') {
    return `<span class="badge promo">PROMO</span>`;
  }
  return `<span class="badge archived">Archived</span>`;
}

function projectCard(p) {
  const status = projectStatus(p, new Date());
  return `
    <article class="card">
      <img src="${withBase(p.image)}" alt="${p.title}" loading="lazy" />
      <div class="card-body">
        ${statusBadge(status)}
        <span class="badge">${p.platform}</span>
        <h3>${p.title}</h3>
        <p>${p.summary}</p>
        <p class="meta">Launch: ${fmt.format(new Date(p.launchDate))} | End: ${fmt.format(new Date(p.endDate))}</p>
        ${p.designer ? `<p class="meta">Designer: ${personLink('designer', p.designer, p.designerSlug)}</p>` : ''}
        ${p.publisher ? `<p class="meta">Publisher: ${personLink('publisher', p.publisher, p.publisherSlug)}</p>` : ''}
        <a href="${p.primaryUrl}" target="_blank" rel="noreferrer">View project</a>
      </div>
    </article>
  `;
}

function projectTile(p) {
  const status = projectStatus(p, new Date());
  return `
    <article class="tile">
      <a class="tile-image-link" href="${p.primaryUrl}" target="_blank" rel="noreferrer">
        <img src="${withBase(p.image)}" alt="${p.title}" loading="lazy" />
      </a>
      <div class="tile-body">
        ${statusBadge(status)}
        <h4><a href="${p.primaryUrl}" target="_blank" rel="noreferrer">${p.title}</a></h4>
      </div>
    </article>
  `;
}

function issueCard(issue) {
  return `
    <article class="issue-item">
      <h3><a href="${withBase(`issue.html?slug=${encodeURIComponent(issue.slug)}`)}">${issue.title}</a></h3>
      <p class="meta">${fmt.format(new Date(issue.weekStart))} to ${fmt.format(new Date(issue.weekEnd))}</p>
      <p>${issue.intro}</p>
      <a href="${withBase(`issue.html?slug=${encodeURIComponent(issue.slug)}`)}">View this week</a>
    </article>
  `;
}

async function loadContent() {
  const res = await fetch(withBase('data/content.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load content.json');
  return res.json();
}

function byWeekDesc(a, b) {
  return new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime();
}

function byEndAsc(a, b) {
  return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
}

function byLaunchDesc(a, b) {
  return new Date(b.launchDate).getTime() - new Date(a.launchDate).getTime();
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
  withBase,
  slugify,
  enrichProjects
};
