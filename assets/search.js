// Search module — client-side search across all projects, designers, and publishers.
// Triggered by a search icon in the site header. Results appear in a top dropdown panel.

(function () {
  'use strict';

  var SEARCH_STORAGE_KEY = 'pnpl_search_history_v1';
  var MAX_RESULTS = 20;
  var MAX_HISTORY = 5;
  var DEBOUNCE_MS = 150;

  var searchState = {
    open: false,
    query: '',
    results: [],
    showAll: false,
    debounceTimer: null,
    content: null,
    enriched: null
  };

  // ── Search Indexing ──────────────────────────────────────────────

  function normalizeText(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(text) {
    return normalizeText(text).split(/\s+/).filter(Boolean);
  }

  function buildSearchIndex(data) {
    var enriched = PNPL.enrichProjects(data);
    var index = [];

    // Index projects
    enriched.forEach(function (p) {
      var titleTokens = tokenize(p.title);
      var summaryTokens = tokenize(p.summary);
      var designerTokens = tokenize(p.designer);
      var publisherTokens = tokenize(p.publisher);
      var platformTokens = tokenize(p.platform);

      index.push({
        type: 'project',
        slug: p.slug,
        title: p.title,
        summary: p.summary || '',
        designer: p.designer || '',
        publisher: p.publisher || '',
        platform: p.platform || '',
        primaryUrl: p.primaryUrl || '',
        launchDate: p.launchDate || '',
        endDate: p.endDate || '',
        titleTokens: titleTokens,
        summaryTokens: summaryTokens,
        designerTokens: designerTokens,
        publisherTokens: publisherTokens,
        platformTokens: platformTokens,
        allTokens: titleTokens.concat(summaryTokens, designerTokens, publisherTokens, platformTokens)
      });
    });

    // Index designers
    (data.designers || []).forEach(function (d) {
      var nameTokens = tokenize(d.name);
      index.push({
        type: 'designer',
        slug: d.slug,
        name: d.name,
        bggUrl: d.bggUrl || '',
        bio: d.bio || '',
        nameTokens: nameTokens,
        allTokens: nameTokens
      });
    });

    // Index publishers
    (data.publishers || []).forEach(function (pub) {
      var nameTokens = tokenize(pub.name);
      index.push({
        type: 'publisher',
        slug: pub.slug,
        name: pub.name,
        bggUrl: pub.bggUrl || '',
        bio: pub.bio || '',
        nameTokens: nameTokens,
        allTokens: nameTokens
      });
    });

    return { index: index, enriched: enriched };
  }

  // ── Search Scoring ───────────────────────────────────────────────

  function scoreProject(queryTokens, item) {
    var score = 0;
    var titleLower = normalizeText(item.title);
    var queryLower = normalizeText(queryTokens.join(' '));

    // Exact title match (highest priority)
    if (titleLower === queryLower) return 1000;

    // Title starts with query
    if (titleLower.indexOf(queryLower) === 0) return 900;

    // Title contains all query tokens
    var allInTitle = queryTokens.every(function (t) {
      return titleLower.indexOf(t) !== -1;
    });
    if (allInTitle) score += 500;

    // Title contains any query token (weighted by position)
    queryTokens.forEach(function (t) {
      var idx = titleLower.indexOf(t);
      if (idx !== -1) {
        score += 200 - (idx * 2);
      }
    });

    // Designer/publisher contains query
    var designerLower = normalizeText(item.designer);
    var publisherLower = normalizeText(item.publisher);
    if (designerLower.indexOf(queryLower) !== -1) score += 100;
    if (publisherLower.indexOf(queryLower) !== -1) score += 100;

    // Summary contains query tokens
    var summaryLower = normalizeText(item.summary);
    queryTokens.forEach(function (t) {
      if (summaryLower.indexOf(t) !== -1) score += 20;
    });

    return score;
  }

  function scorePerson(queryTokens, item) {
    var score = 0;
    var nameLower = normalizeText(item.name);
    var queryLower = normalizeText(queryTokens.join(' '));

    if (nameLower === queryLower) return 1000;
    if (nameLower.indexOf(queryLower) === 0) return 900;

    var allInName = queryTokens.every(function (t) {
      return nameLower.indexOf(t) !== -1;
    });
    if (allInName) score += 500;

    queryTokens.forEach(function (t) {
      var idx = nameLower.indexOf(t);
      if (idx !== -1) score += 200 - (idx * 2);
    });

    return score;
  }

  // ── Search Execution ─────────────────────────────────────────────

  function search(query) {
    if (!query || query.trim().length < 2) {
      searchState.results = [];
      return;
    }

    var tokens = tokenize(query);
    var results = [];
    var index = searchState.index;

    // Score and collect projects
    var projectScores = [];
    index.forEach(function (item) {
      if (item.type === 'project') {
        var s = scoreProject(tokens, item);
        if (s > 0) projectScores.push({ item: item, score: s });
      }
    });

    // Score and collect designers/publishers
    var personScores = [];
    index.forEach(function (item) {
      if (item.type === 'designer' || item.type === 'publisher') {
        var s = scorePerson(tokens, item);
        if (s > 0) personScores.push({ item: item, score: s });
      }
    });

    // Sort by score descending
    projectScores.sort(function (a, b) { return b.score - a.score; });
    personScores.sort(function (a, b) { return b.score - a.score; });

    // Build results: persons first (to link to their pages), then projects
    personScores.forEach(function (r) {
      results.push(r.item);
    });

    var capped = projectScores.slice(0, MAX_RESULTS);
    capped.forEach(function (r) {
      results.push(r.item);
    });

    searchState.results = results;
  }

  // ── Status Grouping ──────────────────────────────────────────────

  function groupResultsByStatus(results) {
    var now = new Date();
    var groups = {
      'Live Now': [],
      'Upcoming': [],
      'Preview': [],
      'Ended': []
    };

    results.forEach(function (item) {
      if (item.type === 'project') {
        var status = PNPL.projectStatus(item, now);
        if (status === 'live' || status === 'promo') groups['Live Now'].push(item);
        else if (status === 'upcoming') groups['Upcoming'].push(item);
        else if (status === 'preview') groups['Preview'].push(item);
        else groups['Ended'].push(item);
      }
    });

    // Only include non-empty groups
    var ordered = [];
    ['Live Now', 'Upcoming', 'Preview', 'Ended'].forEach(function (key) {
      if (groups[key].length > 0) {
        ordered.push({ label: key, items: groups[key] });
      }
    });

    return ordered;
  }

  // ── Rendering ────────────────────────────────────────────────────

  function renderSearchPanel() {
    var query = searchState.query.trim();
    var html = '<div class="search-panel" role="search">';

    // Search input
    html += '<div class="search-input-row">';
    html += '<svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
    html += '<input type="text" class="search-input" placeholder="Search projects, designers, publishers..." value="" autocomplete="off" aria-label="Search" />';
    html += '<button type="button" class="search-close" aria-label="Close search">&times;</button>';
    html += '</div>';

    // Results area
    html += '<div class="search-results">';

    if (query.length < 2) {
      // Show recent searches if available
      var history = readSearchHistory();
      if (history.length > 0) {
        html += '<div class="search-history">';
        html += '<p class="search-history-label">Recent searches</p>';
        html += '<div class="search-history-list">';
        history.forEach(function (term) {
          html += '<button type="button" class="search-history-item" data-search-term="' + escapeHtml(term) + '">' + escapeHtml(term) + '</button>';
        });
        html += '</div>';
        html += '</div>';
      } else {
        html += '<p class="search-empty">Type at least 2 characters to search</p>';
      }
    } else if (searchState.results.length === 0) {
      html += '<p class="search-empty">No results found for "' + escapeHtml(query) + '"</p>';
    } else {
      var groups = groupResultsByStatus(searchState.results);
      groups.forEach(function (group) {
        html += '<div class="search-group">';
        html += '<h3 class="search-group-label">' + escapeHtml(group.label) + ' <span class="search-count">(' + group.items.length + ')</span></h3>';
        group.items.forEach(function (item) {
          if (item.type === 'designer' || item.type === 'publisher') {
            html += renderPersonResult(item);
          } else {
            html += renderProjectResult(item);
          }
        });
        html += '</div>';
      });

      // Show more button if there are more results
      var totalProjects = searchState.results.filter(function (r) { return r.type === 'project'; }).length;
      if (totalProjects > MAX_RESULTS && !searchState.showAll) {
        html += '<button type="button" class="search-show-more">Show ' + (totalProjects - MAX_RESULTS) + ' more results</button>';
      }
    }

    html += '</div>';
    html += '</div>';

    return html;
  }

  function renderProjectResult(item) {
    var status = PNPL.projectStatus(item);
    var statusClass = status;
    if (status === 'promo') statusClass = 'live';
    var statusLabel = status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ');
    var url = item.primaryUrl || '#';

    return '<div class="search-result-item search-result-project" data-url="' + escapeHtml(url) + '">' +
      '<div class="search-result-title">' + escapeHtml(item.title) + '</div>' +
      '<div class="search-result-meta">' +
        '<span class="search-status-badge ' + statusClass + '">' + escapeHtml(statusLabel) + '</span>' +
        (item.designer ? '<span class="search-result-designer">' + escapeHtml(item.designer) + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  function renderPersonResult(item) {
    var personUrl = PNPL.withBase((item.type === 'designer' ? 'designer' : 'publisher') + '.html?slug=' + encodeURIComponent(item.slug));
    return '<div class="search-result-item search-result-person" data-url="' + escapeHtml(personUrl) + '">' +
      '<div class="search-result-title">' + escapeHtml(item.name) + '</div>' +
      '<div class="search-result-meta">' +
        '<span class="search-person-type">' + (item.type === 'designer' ? 'Designer' : 'Publisher') + '</span>' +
      '</div>' +
    '</div>';
  }

  // ── Search History ───────────────────────────────────────────────

  function readSearchHistory() {
    try {
      var raw = localStorage.getItem(SEARCH_STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }

  function saveSearchHistory(term) {
    if (!term || term.length < 2) return;
    var history = readSearchHistory();
    // Remove if already exists
    history = history.filter(function (t) { return t !== term; });
    // Add to front
    history.unshift(term);
    // Trim
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    try {
      localStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify(history));
    } catch (_err) { /* noop */ }
  }

  // ── DOM Integration ──────────────────────────────────────────────

  function initSearch() {
    if (window.__pnplSearchInitialized) return;
    window.__pnplSearchInitialized = true;

    // Add search icon to header
    var headerEl = document.querySelector('.site-header .inner');
    if (!headerEl) return;

    // Create search trigger button
    var searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'search-trigger';
    searchBtn.setAttribute('aria-label', 'Search projects');
    searchBtn.setAttribute('title', 'Search');
    searchBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';

    // Insert before the nav toggle so it sits between brand and hamburger
    var navToggle = headerEl.querySelector('.nav-toggle');
    if (navToggle) {
      headerEl.insertBefore(searchBtn, navToggle);
    } else {
      headerEl.appendChild(searchBtn);
    }

    // Create search panel container
    var searchContainer = document.createElement('div');
    searchContainer.className = 'search-container';
    searchContainer.style.display = 'none';
    document.body.appendChild(searchContainer);

    // ── Event Handlers ─────────────────────────────────────────────

    // Open search
    searchBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openSearch();
    });

    // Close search
    function closeSearch() {
      searchState.open = false;
      searchState.query = '';
      searchState.results = [];
      searchState.showAll = false;
      searchContainer.style.display = 'none';
      searchBtn.classList.remove('active');
      document.body.classList.remove('search-open');
      // Clear the input value
      var input = searchContainer.querySelector('.search-input');
      if (input) input.value = '';
    }

    searchBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSearch();
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!searchState.open) return;
      if (searchContainer.contains(e.target)) return;
      if (searchBtn.contains(e.target)) return;
      closeSearch();
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && searchState.open) {
        closeSearch();
      }
    });

    // ── Open Search ────────────────────────────────────────────────

    function openSearch() {
      searchState.open = true;
      searchContainer.style.display = 'block';
      searchBtn.classList.add('active');
      document.body.classList.add('search-open');

      // Render panel
      searchContainer.innerHTML = renderSearchPanel();

      // Focus input
      var input = searchContainer.querySelector('.search-input');
      if (input) {
        input.focus();
      }

      // Bind input events
      bindSearchInput(input);

      // Bind result clicks
      bindResultClicks();

      // Bind history clicks
      bindHistoryClicks();

      // Bind show more
      bindShowMore();
    }

    function bindSearchInput(input) {
      if (!input) return;

      // Set initial value
      input.value = searchState.query;

      input.addEventListener('input', function () {
        var val = input.value;
        searchState.query = val;

        // Debounce search
        if (searchState.debounceTimer) clearTimeout(searchState.debounceTimer);
        searchState.debounceTimer = setTimeout(function () {
          search(val);
          // Re-render results area only
          var resultsEl = searchContainer.querySelector('.search-results');
          if (resultsEl) {
            resultsEl.innerHTML = renderResultsContent();
            bindResultClicks();
            bindShowMore();
          }
        }, DEBOUNCE_MS);
      });

      // Enter key saves history and navigates
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var val = input.value.trim();
          if (val.length >= 2) {
            saveSearchHistory(val);
            // Navigate to first result
            if (searchState.results.length > 0) {
              var first = searchState.results[0];
              if (first.type === 'project' && first.primaryUrl) {
                window.open(first.primaryUrl, '_blank', 'noopener,noreferrer');
              } else if (first.type === 'designer') {
                window.open(PNPL.withBase('designer.html?slug=' + encodeURIComponent(first.slug)), '_blank', 'noopener,noreferrer');
              } else if (first.type === 'publisher') {
                window.open(PNPL.withBase('publisher.html?slug=' + encodeURIComponent(first.slug)), '_blank', 'noopener,noreferrer');
              }
            }
          }
        }
      });
    }

    function renderResultsContent() {
      var query = searchState.query.trim();
      var html = '';

      if (query.length < 2) {
        var history = readSearchHistory();
        if (history.length > 0) {
          html += '<div class="search-history">';
          html += '<p class="search-history-label">Recent searches</p>';
          html += '<div class="search-history-list">';
          history.forEach(function (term) {
            html += '<button type="button" class="search-history-item" data-search-term="' + escapeHtml(term) + '">' + escapeHtml(term) + '</button>';
          });
          html += '</div>';
          html += '</div>';
        } else {
          html += '<p class="search-empty">Type at least 2 characters to search</p>';
        }
      } else if (searchState.results.length === 0) {
        html += '<p class="search-empty">No results found for "' + escapeHtml(query) + '"</p>';
      } else {
        var groups = groupResultsByStatus(searchState.results);
        groups.forEach(function (group) {
          html += '<div class="search-group">';
          html += '<h3 class="search-group-label">' + escapeHtml(group.label) + ' <span class="search-count">(' + group.items.length + ')</span></h3>';
          var items = group.items;
          if (!searchState.showAll && group.items.length > MAX_RESULTS) {
            items = group.items.slice(0, MAX_RESULTS);
          }
          items.forEach(function (item) {
            if (item.type === 'designer' || item.type === 'publisher') {
              html += renderPersonResult(item);
            } else {
              html += renderProjectResult(item);
            }
          });
          html += '</div>';
        });

        var totalProjects = searchState.results.filter(function (r) { return r.type === 'project'; }).length;
        if (totalProjects > MAX_RESULTS && !searchState.showAll) {
          html += '<button type="button" class="search-show-more">Show ' + (totalProjects - MAX_RESULTS) + ' more results</button>';
        }
      }

      return html;
    }

    function bindResultClicks() {
      searchContainer.querySelectorAll('.search-result-item').forEach(function (el) {
        el.addEventListener('click', function () {
          var url = el.getAttribute('data-url');
          if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        });
      });
    }

    function bindHistoryClicks() {
      searchContainer.querySelectorAll('.search-history-item').forEach(function (el) {
        el.addEventListener('click', function () {
          var term = el.getAttribute('data-search-term');
          if (term) {
            var input = searchContainer.querySelector('.search-input');
            if (input) {
              input.value = term;
              searchState.query = term;
              search(term);
              var resultsEl = searchContainer.querySelector('.search-results');
              if (resultsEl) {
                resultsEl.innerHTML = renderResultsContent();
                bindResultClicks();
                bindShowMore();
                input.focus();
              }
            }
          }
        });
      });
    }

    function bindShowMore() {
      var showMoreBtn = searchContainer.querySelector('.search-show-more');
      if (showMoreBtn) {
        showMoreBtn.addEventListener('click', function () {
          searchState.showAll = true;
          var resultsEl = searchContainer.querySelector('.search-results');
          if (resultsEl) {
            resultsEl.innerHTML = renderResultsContent();
            bindResultClicks();
          }
        });
      }
    }

    // ── Load content ───────────────────────────────────────────────

    PNPL.loadContent().then(function (data) {
      searchState.content = data;
      var indexed = buildSearchIndex(data);
      searchState.index = indexed.index;
      searchState.enriched = indexed.enriched;
    }).catch(function (err) {
      console.error('[PNPL Search] Failed to load content:', err);
    });
  }

  // ── Init ─────────────────────────────────────────────────────────

  // The header is rendered by PNPL.header() in the inline script AFTER
  // search.js loads, so we can't query it at module scope. Use an
  // observer to wait for the header to appear, then inject the search UI.
  var searchObserver = new MutationObserver(function () {
    if (document.querySelector('.site-header .inner')) {
      searchObserver.disconnect();
      initSearch();
    }
  });
  searchObserver.observe(document.body, { childList: true, subtree: true });

  // Also expose for potential programmatic use
  window.PNPLSearch = {
    init: initSearch,
    search: search,
    getResults: function () { return searchState.results; }
  };

})();
