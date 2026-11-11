'use strict';

(() => {
  const CATEGORIES = {
    all: { label: 'Everything' },
    android: { label: 'Android Ports' },
    emulators: { label: 'Emulators' },
    native: { label: 'Native Ports' },
    recompilations: { label: 'Recompilations' },
    tools: { label: 'Tools' },
  };
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const state = {
    category: CATEGORIES[params.get('category')] ? params.get('category') : 'all',
    query: params.get('q') || '',
    sort: ['popular', 'recent', 'az'].includes(params.get('sort')) ? params.get('sort') : 'popular',
  };
  const expanded = new Set();
  const dialog = $('project-dialog');
  let projects = [];
  let byId = new Map();
  let previousHash = location.hash.startsWith('#project/') ? '#library' : location.hash;
  let returnFocus = null;

  function node(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    el.append(...children.filter(x => x !== null && x !== undefined));
    return el;
  }
  function icon(name, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    if (className) svg.setAttribute('class', className);
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }
  const formatDate = date => date ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(date)) : 'No release';
  const normalize = str => str.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const projectVersion = project => {
    const version = project.displayVersion || project.version;
    return version ? (/^\d/.test(version) ? `v${version}` : version) : null;
  };
  const latestUpdate = project => [project.updated, project.releaseUpdated, project.assetUpdated, project.released].filter(Boolean).sort().at(-1) || '';
  const sorts = {
    popular: (a, b) => b.stars - a.stars || a.title.localeCompare(b.title),
    recent: (a, b) => latestUpdate(b).localeCompare(latestUpdate(a)) || a.title.localeCompare(b.title),
    az: (a, b) => a.title.localeCompare(b.title),
  };
  function syncUrl() {
    const url = new URL(location.href);
    for (const key of ['category', 'q', 'sort', 'archived']) url.searchParams.delete(key);
    if (state.category !== 'all') url.searchParams.set('category', state.category);
    if (state.query) url.searchParams.set('q', state.query);
    if (state.sort !== 'popular') url.searchParams.set('sort', state.sort);
    history.replaceState(null, '', url);
  }
  function filteredProjects() {
    const words = normalize(state.query.trim()).split(/\s+/).filter(Boolean);
    return projects.filter(p => state.category === 'all' || state.category === p.category)
      .filter(p => words.every(w => normalize(`${p.title} ${p.id} ${p.platform} ${p.description} ${CATEGORIES[p.category].label}`).includes(w)))
      .sort(sorts[state.sort]);
  }
  function artwork(project, badge = false) {
    const wrap = node('div', { class: 'art' + (project.imageFit === 'contain' ? ' contain' : '') });
    if (project.imageBackground) wrap.style.backgroundColor = project.imageBackground;
    if (project.image) {
      const img = node('img', { src: project.image, alt: '', loading: 'lazy', decoding: 'async', width: 256, height: 256 });
      img.addEventListener('error', () => { img.remove(); wrap.append(icon('native')); }, { once: true });
      wrap.append(img);
    } else wrap.append(icon('native'));
    if (badge && (project.archived || project.experimental || project.prerelease)) {
      wrap.append(node('span', { class: `card-badge${project.experimental ? ' warning' : ''}` }, project.archived ? 'Archived' : project.experimental ? 'Experimental' : 'Pre-release'));
    }
    return wrap;
  }
  function categoryControls() {
    const buttons = Object.entries(CATEGORIES).map(([id, info]) => {
      const count = projects.filter(p => id === 'all' || p.category === id).length;
      const button = node('button', { type: 'button', class: 'category-tab', 'aria-pressed': String(state.category === id), 'data-category': id }, info.label, node('span', { class: 'tab-count', 'aria-hidden': 'true' }, count));
      button.addEventListener('click', () => {
        state.category = id;
        expanded.clear();
        update();
        $('categories').querySelector(`[data-category="${id}"]`).focus({ preventScroll: true });
      });
      return button;
    });
    $('categories').replaceChildren(...buttons);
  }
  function projectCard(p) {
    const version = projectVersion(p) || (p.directLink ? 'Official repository' : 'Source only');
    const footer = node('div', { class: 'card-footer' }, node('span', {}, version), node('span', { class: 'card-stars', 'aria-label': `${p.stars} GitHub stars` }, icon('star'), new Intl.NumberFormat('en').format(p.stars)));
    const article = node('article', { class: 'project-card', 'data-project': p.id }, node('a', { href: p.directLink ? p.repo : `#project/${encodeURIComponent(p.id)}`, 'aria-label': `${p.title} — ${p.directLink ? 'official repository' : p.archived ? 'archived project' : p.experimental ? 'experimental project' : 'details and downloads'}` }, artwork(p, true), node('h4', { class: 'card-title' }, p.title), footer));
    if (p.continued) article.append(node('a', { class: 'continued-link', href: p.continued }, 'Continued by Chansey', icon('external')));
    if (p.upstreamed) article.append(node('a', { class: 'continued-link', href: p.repo }, 'Contributed upstream', icon('external')));
    return article;
  }
  function renderGroups() {
    const visible = filteredProjects();
    const groups = [];
    for (const [category, info] of Object.entries(CATEGORIES)) {
      if (category === 'all') continue;
      const list = visible.filter(p => p.category === category);
      if (!list.length) continue;
      const limit = expanded.has(category) || state.query.trim() || state.category !== 'all' ? list.length : 12;
      const heading = node('div', { class: 'group-heading' }, node('h3', { id: `heading-${category}` }, info.label, node('span', {}, list.length)));
      const grid = node('div', { class: 'project-grid' }, ...list.slice(0, limit).map(projectCard));
      const section = node('section', { class: 'project-group', 'aria-labelledby': `heading-${category}` }, heading, grid);
      if (list.length > limit) {
        const more = node('button', { type: 'button', class: 'group-more' }, `Explore all ${list.length} ${info.label.toLowerCase()}`, icon('arrow'));
        more.addEventListener('click', () => {
          expanded.add(category);
          renderGroups();
          document.querySelector(`[data-project="${CSS.escape(list[limit].id)}"] a`)?.focus({ preventScroll: true });
        });
        section.append(more);
      }
      groups.push(section);
    }
    $('project-groups').replaceChildren(...groups);
    $('empty-state').hidden = visible.length !== 0;
    const suffix = state.query.trim() ? ` matching “${state.query.trim()}”` : state.category !== 'all' ? ` in ${CATEGORIES[state.category].label}` : ' in the collection';
    $('result-count').textContent = `${visible.length} project${visible.length === 1 ? '' : 's'}${suffix}`;
  }
  function update() { categoryControls(); renderGroups(); syncUrl(); }
  function renderRecap() {
    const number = value => new Intl.NumberFormat('en').format(value);
    const metrics = [
      [projects.length, 'projects'],
      [projects.reduce((sum, p) => sum + p.stars, 0), 'stars', 'GitHub stars across the listed repositories'],
      [projects.reduce((sum, p) => sum + (p.downloads || 0), 0), 'downloads', 'Release-file downloads across all listed repositories and versions. One person can download multiple files or versions; this is not a unique-user count.'],
    ];
    $('recap').replaceChildren(...metrics.map(([value, label, title]) => node('div', { class: 'metric', title }, node('strong', {}, number(value)), node('span', { class: 'metric-label' }, label))));
  }
  function renderRecent() {
    const latest = projects.filter(p => !p.archived && latestUpdate(p)).sort(sorts.recent).slice(0, 8);
    $('recent-grid').replaceChildren(...latest.map(p => {
      const version = projectVersion(p) || 'Source';
      return node('a', { class: 'recent-card', href: p.directLink ? p.repo : `#project/${encodeURIComponent(p.id)}` }, artwork(p, true), node('div', { class: 'recent-info' }, node('h3', {}, p.title), node('p', { title: `Latest repository or release update: ${formatDate(latestUpdate(p))}` }, node('span', {}, version), ' · ' + formatDate(latestUpdate(p)))));
    }));
  }
  function showProject(p) {
    if (!dialog.open) returnFocus = document.activeElement;
    const meta = [['Latest version', p.displayVersion || p.version || 'Source only'], ['Release date', formatDate(p.released)], ['GitHub stars', new Intl.NumberFormat('en').format(p.stars)]];
    const details = node('dl', { class: 'dialog-meta' }, ...meta.map(([label, value]) => node('div', {}, node('dt', {}, label), node('dd', {}, value))));
    const note = node('aside', { class: `project-note${p.archived || p.experimental ? ' warning' : ''}` }, node('strong', {}, p.archived ? 'Archived project' : p.experimental ? 'Experimental build' : p.category === 'tools' ? 'Before you install' : 'What you need'), p.note);
    const actions = node('div', { class: 'dialog-actions' });
    if (p.continued) actions.append(node('a', { href: p.continued, class: 'button primary' }, 'View maintained project', icon('external')));
    else if (!p.archived && p.releaseUrl) actions.append(node('a', { href: p.downloadUrl || p.releaseUrl, class: 'button primary' }, p.downloadUrl ? `Download ${p.assetName}` : 'View release', icon('download')));
    const guideUrl = p.category === 'native' || p.category === 'recompilations' ? p.releaseUrl || `${p.repo}#readme` : `${p.repo}#readme`;
    actions.append(node('a', { href: guideUrl, class: 'button secondary' }, 'Installation guide', icon('arrow')));
    if (!p.hideSource) actions.append(node('a', { href: p.repo, class: 'button secondary' }, p.upstreamed ? 'Original repository' : 'Source code', icon('github')));
    const credits = node('p', { class: 'dialog-credits' }, `Repository: ${p.repo.replace('https://github.com/', '')}. `);
    if (p.upstream) credits.append('Based on ', node('a', { href: `https://github.com/${p.upstream}` }, p.upstream), '. ');
    if (p.contributionUrl) credits.append(node('a', { href: p.contributionUrl }, 'Nintendo Switch port contributed by NaGaa95 (merged upstream)'), '. ');
    credits.append('See the project for full credits and licensing.');
    const children = [node('div', { class: 'dialog-header' }, artwork(p), node('div', {}, node('p', { class: 'dialog-category' }, CATEGORIES[p.category].label), node('h2', { id: 'dialog-title' }, p.title))), node('p', { class: 'dialog-description' }, p.description), details, note, actions, credits];
    if (p.releaseNotes) children.push(node('details', { class: 'release-notes' }, node('summary', {}, 'Release notes'), node('pre', {}, p.releaseNotes)));
    $('dialog-content').replaceChildren(...children);
    document.title = `${p.title} · NaGaa95`;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    $('close-dialog').focus({ preventScroll: true });
  }
  function readHash() {
    if (location.hash.startsWith('#project/')) {
      let id;
      try { id = decodeURIComponent(location.hash.slice(9)); } catch { return; }
      const project = byId.get(id);
      if (project) showProject(project);
    } else {
      previousHash = location.hash;
      if (dialog.open) dialog.close();
    }
  }
  function closeDialog() { if (dialog.open) dialog.close(); }
  function themeButton() {
    const light = document.documentElement.dataset.theme === 'light';
    $('theme-toggle').setAttribute('aria-label', `Switch to ${light ? 'dark' : 'light'} theme`);
    document.querySelector('meta[name="theme-color"]').content = light ? '#f5f5f7' : '#1b1d21';
  }
  $('theme-toggle').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('nagaa-theme', theme); } catch { /* Preference lasts for this visit. */ }
    themeButton();
  });
  themeButton();
  $('close-dialog').addEventListener('click', closeDialog);
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(); } });
  dialog.addEventListener('close', () => {
    if (location.hash.startsWith('#project/')) history.replaceState(null, '', location.pathname + location.search + previousHash);
    document.title = 'NaGaa95 · Switch ports & homebrew';
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  });
  addEventListener('hashchange', readHash);
  $('search').value = state.query;
  $('sort').value = state.sort;
  $('search').addEventListener('input', e => { state.query = e.target.value; expanded.clear(); update(); });
  $('search').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.target.value = ''; state.query = ''; update(); } });
  $('sort').addEventListener('change', e => { state.sort = e.target.value; update(); });
  $('reset-filters').addEventListener('click', () => { Object.assign(state, { category: 'all', query: '', sort: 'popular' }); $('search').value = ''; $('sort').value = 'popular'; expanded.clear(); update(); $('search').focus(); });
  document.addEventListener('keydown', e => { if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !dialog.open && !e.target.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); $('search').focus(); $('search').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth' }); } });

  async function main() {
    try {
      const response = await fetch('data/catalog.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.projects)) throw new Error('Invalid catalogue');
      projects = data.projects.filter(p => CATEGORIES[p.category] && p.category !== 'all');
      byId = new Map(projects.map(p => [p.id, p]));
      renderRecap(); renderRecent(); update(); readHash();
    } catch (error) {
      $('project-groups').replaceChildren(node('p', { class: 'data-error' }, 'The library could not be loaded. ', node('a', { href: 'https://github.com/NaGaa95?tab=repositories' }, 'Browse the projects on GitHub'), ' or refresh to try again.'));
      $('recent-grid').replaceChildren(node('p', { class: 'loading' }, 'Releases are available on GitHub.'));
      $('result-count').textContent = 'Library temporarily unavailable';
      $('recap').textContent = '';
      console.error('Catalogue loading failed:', error);
    }
  }
  main();
})();
