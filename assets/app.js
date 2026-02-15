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

function header(active = '') {
  const links = [
    ['', 'Home'],
    ['issues.html', 'Issues'],
    ['archive.html', 'Archive'],
    ['submit.html', 'Submit a Project'],
    ['admin/', 'Editor Login']
  ];

  return `
    <header class="site-header">
      <div class="inner">
        <h1 class="brand"><a href="${withBase('')}">PnP Launchpad</a></h1>
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

function projectCard(p, archived) {
  return `
    <article class="card">
      <img src="${withBase(p.image)}" alt="${p.title}" loading="lazy" />
      <div class="card-body">
        <span class="badge ${archived ? 'archived' : 'live'}">${archived ? 'Archived' : 'Live / Upcoming'}</span>
        <span class="badge">${p.platform}</span>
        <h3>${p.title}</h3>
        <p>${p.summary}</p>
        <p class="meta">Launch: ${fmt.format(new Date(p.launchDate))} | End: ${fmt.format(new Date(p.endDate))}</p>
        ${p.designer ? `<p class="meta">Designer: ${p.designer}</p>` : ''}
        ${p.publisher ? `<p class="meta">Publisher: ${p.publisher}</p>` : ''}
        <a href="${p.primaryUrl}" target="_blank" rel="noreferrer">View project</a>
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
      <a href="${withBase(`issue.html?slug=${encodeURIComponent(issue.slug)}`)}">Open issue</a>
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

window.PNPL = {
  header,
  footer,
  projectCard,
  issueCard,
  loadContent,
  byWeekDesc,
  byEndAsc
};
