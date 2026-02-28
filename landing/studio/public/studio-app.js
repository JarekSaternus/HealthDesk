/* HealthDesk Blog Studio — Frontend */

let currentArticle = null; // { lang, slug }
let currentMarkdown = '';
let allArticles = [];

// ─── Navigation ───
document.querySelectorAll('[data-view]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    switchView(link.dataset.view);
  });
});

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');

  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  const nav = document.querySelector(`[data-view="${view}"]`);
  if (nav) nav.classList.add('active');

  if (view === 'dashboard') loadDashboard();
  if (view === 'ideas') loadIdeas();
  if (view === 'checker' && currentMarkdown) {
    renderCheckerText();
  }
}

// ─── Dashboard ───
async function loadDashboard() {
  const res = await fetch('/api/articles');
  const data = await res.json();
  allArticles = data.articles;

  const filterLang = document.getElementById('filter-lang').value;
  const filterStatus = document.getElementById('filter-status').value;

  let filtered = allArticles;
  if (filterLang) filtered = filtered.filter(a => a.lang === filterLang);
  if (filterStatus) filtered = filtered.filter(a => a.status === filterStatus);

  // Stats
  const stats = document.getElementById('stats-bar');
  const langs = [...new Set(allArticles.map(a => a.lang))];
  const totalWords = allArticles.reduce((s, a) => s + a.wordCount, 0);
  stats.innerHTML = `
    <div class="stat-card"><div class="stat-val">${allArticles.length}</div><div class="stat-label">Articles</div></div>
    <div class="stat-card"><div class="stat-val">${langs.length}</div><div class="stat-label">Languages</div></div>
    <div class="stat-card"><div class="stat-val">${Math.round(totalWords/1000)}k</div><div class="stat-label">Total Words</div></div>
    <div class="stat-card"><div class="stat-val">${allArticles.filter(a=>a.status==='published').length}</div><div class="stat-label">Published</div></div>
  `;

  // Populate lang filter
  const langSelect = document.getElementById('filter-lang');
  if (langSelect.options.length <= 1) {
    langs.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l; opt.textContent = l.toUpperCase();
      langSelect.appendChild(opt);
    });
  }

  // Render grid
  const grid = document.getElementById('articles-grid');
  if (filtered.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-dim)">No articles found. Create one!</p>';
    return;
  }
  grid.innerHTML = filtered.map(a => `
    <div class="article-card" onclick="openArticle('${a.lang}','${a.slug}')">
      <div class="article-card-header">
        <h3>${escHtml(a.title)}</h3>
        <div style="display:flex;gap:0.4rem;align-items:center;">
          <span class="badge badge-${a.status}">${a.status}</span>
          <button class="btn-close" title="Delete" onclick="event.stopPropagation();deleteArticle('${a.lang}','${a.slug}')">&times;</button>
        </div>
      </div>
      <div class="article-card-meta">
        <span class="lang-flag">${a.lang.toUpperCase()}</span>
        <span>${a.date || 'no date'}</span>
        <span>${a.wordCount} words</span>
        ${Object.keys(a.siblings).length ? '<span>+ ' + Object.keys(a.siblings).length + ' translations</span>' : ''}
      </div>
      ${a.description ? '<div class="article-card-desc">' + escHtml(a.description).slice(0, 120) + '</div>' : ''}
    </div>
  `).join('');
}

// ─── Open article in editor ───
async function openArticle(lang, slug) {
  const res = await fetch(`/api/articles/${lang}/${slug}`);
  if (!res.ok) { alert('Failed to load article'); return; }
  const data = await res.json();

  currentArticle = { lang, slug };
  currentMarkdown = data.markdown;

  // Fill frontmatter form
  document.getElementById('fm-title').value = data.frontmatter.title || '';
  document.getElementById('fm-slug').value = data.frontmatter.slug || slug;
  document.getElementById('fm-desc').value = data.frontmatter.description || '';
  document.getElementById('fm-date').value = data.frontmatter.date ? String(data.frontmatter.date).slice(0,10) : '';
  document.getElementById('fm-tags').value = (data.frontmatter.tags || []).join(', ');
  document.getElementById('fm-lang').value = lang;
  document.getElementById('editor-title').textContent = data.frontmatter.title || slug;

  // Editor
  document.getElementById('md-editor').value = data.markdown;
  document.getElementById('md-preview').innerHTML = data.html;

  updateSEOLive();
  switchView('editor');
}

// ─── Editor input ───
function onEditorInput() {
  const md = document.getElementById('md-editor').value;
  currentMarkdown = md;
  // Debounced preview
  clearTimeout(window._previewTimer);
  window._previewTimer = setTimeout(() => {
    fetch('/api/seo/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frontmatter: getFrontmatter(), markdown: md, lang: currentArticle?.lang || 'pl' })
    }).then(r => r.json()).then(renderPreviewAndSEO);
  }, 500);
}

function renderPreviewAndSEO(data) {
  // We need html preview — let's use marked on client side (simple approach: re-fetch)
  // For now just update via marked-like rendering from server response
  // Actually, let's just parse the markdown to HTML inline:
  const md = document.getElementById('md-editor').value;
  document.getElementById('md-preview').innerHTML = simpleMarkdown(md);
}

function simpleMarkdown(md) {
  // Minimal markdown renderer for live preview
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^\> (.+)$/gm, '<blockquote><p>$1</p></blockquote>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => '<ul>' + m + '</ul>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hublao])/gm, '<p>')
    .replace(/<p><(h[1-3]|ul|blockquote|li)/g, '<$1')
    .replace(/<\/p>$/gm, '');
}

function updateSEOLive() {
  const title = document.getElementById('fm-title').value;
  const desc = document.getElementById('fm-desc').value;
  document.getElementById('fm-title-count').textContent = title.length + '/60';
  document.getElementById('fm-title-count').style.color = (title.length >= 40 && title.length <= 65) ? 'var(--green)' : 'var(--yellow)';
  document.getElementById('fm-desc-count').textContent = desc.length + '/160';
  document.getElementById('fm-desc-count').style.color = (desc.length >= 100 && desc.length <= 165) ? 'var(--green)' : 'var(--yellow)';
}

function getFrontmatter() {
  return {
    title: document.getElementById('fm-title').value,
    slug: document.getElementById('fm-slug').value,
    description: document.getElementById('fm-desc').value,
    date: document.getElementById('fm-date').value,
    tags: document.getElementById('fm-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    lang: document.getElementById('fm-lang').value,
    siblings: currentArticle ? (allArticles.find(a => a.lang === currentArticle.lang && a.slug === currentArticle.slug) || {}).siblings || {} : {}
  };
}

// ─── Save article ───
async function saveArticle() {
  if (!currentArticle) { alert('No article open'); return; }

  const frontmatter = getFrontmatter();
  const markdown = document.getElementById('md-editor').value;

  const res = await fetch(`/api/articles/${currentArticle.lang}/${currentArticle.slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frontmatter, markdown })
  });

  if (res.ok) {
    showToast('Saved!');
    // Update slug if changed
    if (frontmatter.slug !== currentArticle.slug) {
      currentArticle.slug = frontmatter.slug;
    }
  } else {
    alert('Save failed');
  }
}

// ─── SEO Check ───
async function runSEOCheck() {
  if (!currentArticle) { alert('Open an article first'); return; }

  const frontmatter = getFrontmatter();
  const markdown = document.getElementById('md-editor').value;

  const res = await fetch('/api/seo/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frontmatter, markdown, lang: currentArticle.lang })
  });
  const data = await res.json();

  const panel = document.getElementById('seo-panel');
  panel.classList.remove('hidden');
  document.getElementById('seo-score').textContent = data.score + '%';
  document.getElementById('seo-score').style.color = data.score >= 80 ? 'var(--green)' : data.score >= 50 ? 'var(--yellow)' : 'var(--red)';

  document.getElementById('seo-checks').innerHTML = data.checks.map(c => `
    <div class="seo-check">
      <span class="seo-icon ${c.pass ? 'pass' : 'fail'}">${c.pass ? '&#10003;' : '&#10007;'}</span>
      <span class="seo-label">${c.label}</span>
      <span class="seo-value">${c.value}</span>
    </div>
    ${!c.pass ? '<div class="seo-hint">' + c.hint + '</div>' : ''}
  `).join('');
}

// ─── Checker ───
function renderCheckerText() {
  const el = document.getElementById('checker-text');
  if (currentMarkdown) {
    el.innerHTML = simpleMarkdown(currentMarkdown);
  }
}

async function runGrammarCheck() {
  if (!currentMarkdown) { alert('Open an article first'); return; }

  const sidebar = document.getElementById('checker-results');
  sidebar.innerHTML = '<p style="color:var(--text-dim)">Checking grammar...</p>';

  // Strip markdown
  const plain = currentMarkdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/`[^`]+`/g, '');

  const lang = currentArticle?.lang || 'pl';

  try {
    const res = await fetch('/api/check/grammar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: plain, lang })
    });
    const data = await res.json();

    if (!data.matches || data.matches.length === 0) {
      sidebar.innerHTML = '<p style="color:var(--green);font-weight:600;">No issues found!</p>';
      return;
    }

    sidebar.innerHTML = `<p style="margin-bottom:0.75rem;font-weight:600;">${data.matches.length} issue(s) found</p>` +
      data.matches.map(m => `
        <div class="grammar-issue">
          <div class="grammar-issue-msg">${escHtml(m.message)}</div>
          <div class="grammar-issue-ctx">"...${escHtml(m.context.text.slice(Math.max(0,m.context.offset-10), m.context.offset + m.context.length + 10))}..."</div>
          ${m.replacements && m.replacements.length ? '<div class="grammar-issue-fix">Suggestion: ' + m.replacements.slice(0,3).map(r => '<strong>'+escHtml(r.value)+'</strong>').join(', ') + '</div>' : ''}
        </div>
      `).join('');

    // Highlight errors in text
    highlightErrors(data.matches);
  } catch (err) {
    sidebar.innerHTML = '<p style="color:var(--red)">Error: ' + err.message + '</p>';
  }
}

function highlightErrors(matches) {
  const el = document.getElementById('checker-text');
  let html = el.innerHTML;
  // Simple: we can't reliably match positions in HTML, so just note the count
  // A full implementation would track offsets — for now the sidebar is the main UI
}

async function runReadabilityCheck() {
  if (!currentMarkdown) { alert('Open an article first'); return; }

  const lang = currentArticle?.lang || 'pl';
  const res = await fetch('/api/check/readability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: currentMarkdown, lang })
  });
  const data = await res.json();

  const sidebar = document.getElementById('checker-results');
  const fleschColor = data.fleschScore >= 60 ? 'var(--green)' : data.fleschScore >= 40 ? 'var(--yellow)' : 'var(--red)';

  sidebar.innerHTML = `
    <div class="readability-card">
      <div class="stat-val" style="color:${fleschColor}">${data.fleschScore}</div>
      <div class="stat-label">Flesch Score (${data.fleschLabel})</div>
    </div>
    <div class="readability-card">
      <div class="stat-val">${data.wordCount}</div>
      <div class="stat-label">Words</div>
    </div>
    <div class="readability-card">
      <div class="stat-val">${data.sentenceCount}</div>
      <div class="stat-label">Sentences</div>
    </div>
    <div class="readability-card">
      <div class="stat-val">${data.avgSentenceLength}</div>
      <div class="stat-label">Avg Sentence Length</div>
    </div>
    <div class="readability-card">
      <div class="stat-val" style="color:${data.longSentences > 3 ? 'var(--yellow)' : 'var(--green)'}">${data.longSentences}</div>
      <div class="stat-label">Long Sentences (25+)</div>
    </div>
    ${data.issues.length ? '<div style="margin-top:1rem">' + data.issues.map(i => '<p style="color:var(--yellow);font-size:0.8rem;margin-bottom:0.3rem;">&#9888; ' + i + '</p>').join('') + '</div>' : '<p style="color:var(--green);margin-top:1rem;font-size:0.85rem;">No readability issues!</p>'}
  `;
}

// ─── Ideas ───
async function loadIdeas() {
  const res = await fetch('/api/ideas');
  const ideas = await res.json();

  const list = document.getElementById('ideas-list');
  if (ideas.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim)">No ideas yet. Add a keyword above.</p>';
    return;
  }
  list.innerHTML = ideas.map(i => `
    <div class="idea-item">
      <div class="idea-item-left">
        <span class="lang-flag">${i.lang.toUpperCase()}</span>
        <span class="idea-keyword">${escHtml(i.keyword)}</span>
        ${i.notes ? '<span class="idea-notes">' + escHtml(i.notes) + '</span>' : ''}
      </div>
      <div class="idea-actions">
        <button class="btn btn-sm" onclick="ideaOutline('${escAttr(i.keyword)}','${i.lang}')">AI Outline</button>
        <button class="btn btn-sm" onclick="ideaToArticle('${i.id}','${escAttr(i.keyword)}','${i.lang}')">Create Article</button>
        <button class="btn btn-sm" onclick="deleteIdea('${i.id}')">&times;</button>
      </div>
    </div>
  `).join('');
}

async function addIdea() {
  const keyword = document.getElementById('idea-keyword').value.trim();
  if (!keyword) return;

  await fetch('/api/ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyword,
      lang: document.getElementById('idea-lang').value,
      notes: document.getElementById('idea-notes').value
    })
  });

  document.getElementById('idea-keyword').value = '';
  document.getElementById('idea-notes').value = '';
  loadIdeas();
}

async function deleteIdea(id) {
  await fetch(`/api/ideas/${id}`, { method: 'DELETE' });
  loadIdeas();
}

function ideaOutline(keyword, lang) {
  document.getElementById('idea-keyword').value = keyword;
  document.getElementById('idea-lang').value = lang;
  aiOutlineFromInput();
}

function ideaToArticle(id, keyword, lang) {
  document.getElementById('new-lang').value = lang;
  document.getElementById('new-title').value = keyword;
  document.getElementById('new-slug').value = slugify(keyword);
  showNewArticleModal();
}

// ─── New article ───
function showNewArticleModal() {
  document.getElementById('modal-new').classList.remove('hidden');
  document.getElementById('new-title').focus();
}
function closeModal() {
  document.getElementById('modal-new').classList.add('hidden');
}

document.getElementById('new-title').addEventListener('input', () => {
  const slug = document.getElementById('new-slug');
  if (!slug._manual) {
    slug.value = slugify(document.getElementById('new-title').value);
  }
});
document.getElementById('new-slug').addEventListener('input', function() { this._manual = true; });

async function createArticle() {
  const lang = document.getElementById('new-lang').value;
  const title = document.getElementById('new-title').value.trim();
  const slug = document.getElementById('new-slug').value.trim() || slugify(title);

  if (!title || !slug) { alert('Title and slug required'); return; }

  const res = await fetch('/api/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, slug, title })
  });

  if (res.ok) {
    closeModal();
    openArticle(lang, slug);
  } else {
    const err = await res.json();
    alert(err.error || 'Failed');
  }
}

// ─── Build & Deploy ───
async function runBuild() {
  const btn = document.getElementById('btn-build');
  btn.disabled = true;
  btn.textContent = 'Building...';

  const logEl = document.getElementById('build-log');
  const logContent = document.getElementById('build-log-content');
  logEl.classList.remove('hidden');
  logContent.textContent = 'Running build...\n';

  try {
    const res = await fetch('/api/build', { method: 'POST' });
    const data = await res.json();
    logContent.textContent = data.ok ? data.output : 'Error: ' + data.error;
  } catch (err) {
    logContent.textContent = 'Error: ' + err.message;
  }

  btn.disabled = false;
  btn.textContent = 'Build';
}

async function runDeploy() {
  if (!confirm('Deploy to production (healthdesk.site)? Make sure you built first.')) return;

  const btn = document.getElementById('btn-deploy');
  btn.disabled = true;
  btn.textContent = 'Deploying...';

  const logEl = document.getElementById('build-log');
  const logContent = document.getElementById('build-log-content');
  logEl.classList.remove('hidden');
  logContent.textContent = 'Deploying to FTP...\n';

  try {
    const res = await fetch('/api/deploy', { method: 'POST' });
    const data = await res.json();
    logContent.textContent = data.ok ? data.output : 'Error: ' + data.error;
  } catch (err) {
    logContent.textContent = 'Error: ' + err.message;
  }

  btn.disabled = false;
  btn.textContent = 'Deploy to Production';
}

// ─── Preview article ───
function previewArticle() {
  if (!currentArticle) { alert('Open an article first'); return; }
  const slug = document.getElementById('fm-slug').value || currentArticle.slug;
  const lang = currentArticle.lang;
  window.open(`/preview/${lang}/blog/${slug}/`, '_blank');
}

// ─── Delete article ───
async function deleteArticle(lang, slug) {
  if (!confirm(`Delete article "${lang}/${slug}"? This cannot be undone.`)) return;

  const res = await fetch(`/api/articles/${lang}/${slug}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('Article deleted');
    if (currentArticle && currentArticle.lang === lang && currentArticle.slug === slug) {
      currentArticle = null;
      currentMarkdown = '';
    }
    switchView('dashboard');
  } else {
    alert('Failed to delete article');
  }
}

// ─── Article status ───
async function setStatus(lang, slug, status) {
  await fetch(`/api/articles/${lang}/${slug}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  loadDashboard();
}

// ─── Utilities ───
function slugify(text) {
  return text.toLowerCase()
    .replace(/[ąà]/g,'a').replace(/[ćč]/g,'c').replace(/[ę]/g,'e')
    .replace(/[łĺ]/g,'l').replace(/[ńñ]/g,'n').replace(/[óò]/g,'o')
    .replace(/[śš]/g,'s').replace(/[źżž]/g,'z').replace(/[üú]/g,'u')
    .replace(/[ö]/g,'o').replace(/[ä]/g,'a').replace(/[ß]/g,'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;background:var(--green);color:#000;padding:0.6rem 1.2rem;border-radius:8px;font-weight:600;font-size:0.85rem;z-index:200;animation:fadeIn 0.2s';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// Keyboard shortcut: Ctrl+S to save
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (currentArticle) saveArticle();
  }
});

// ─── AI: Outline from keyword ───
async function aiOutlineFromInput() {
  const keyword = document.getElementById('idea-keyword').value.trim();
  if (!keyword) { alert('Enter a keyword first'); return; }
  const lang = document.getElementById('idea-lang').value;

  const btn = document.getElementById('btn-ai-outline');
  btn.disabled = true; btn.textContent = 'Generating...';

  const resultEl = document.getElementById('ai-outline-result');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = '<p style="color:var(--text-dim)">AI is generating outline...</p>';

  try {
    const res = await fetch('/api/ai/outline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, lang })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    window._lastOutline = data;

    resultEl.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.25rem;margin-bottom:1rem;">
        <h3 style="margin-bottom:0.5rem;">${escHtml(data.title)}</h3>
        <p style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.75rem;">${escHtml(data.description)}</p>
        <p style="font-size:0.75rem;margin-bottom:0.75rem;">Tags: ${(data.tags||[]).map(t => '<span class="badge badge-draft">'+t+'</span>').join(' ')}</p>
        <div style="font-size:0.85rem;">
          ${(data.outline||[]).map(s => `
            <p style="font-weight:600;margin:0.5rem 0 0.2rem;">H2: ${escHtml(s.h2)}</p>
            ${(s.h3||[]).map(h => '<p style="color:var(--text-dim);margin-left:1rem;">H3: '+escHtml(h)+'</p>').join('')}
          `).join('')}
        </div>
        <div style="margin-top:1rem;display:flex;gap:0.5rem;">
          <button class="btn btn-primary btn-sm" onclick="createFromOutline('${lang}')">Create Article from Outline</button>
          <button class="btn btn-sm" onclick="createAndDraftFromOutline('${lang}')">Create + AI Write Draft</button>
        </div>
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = '<p style="color:var(--red)">Error: ' + escHtml(err.message) + '</p>';
  }

  btn.disabled = false; btn.textContent = 'AI Outline';
}

async function createFromOutline(lang) {
  const data = window._lastOutline;
  if (!data) return;

  const slug = slugify(data.title);
  const res = await fetch('/api/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, slug, title: data.title })
  });

  if (res.ok) {
    // Save with outline as skeleton
    const outlineMd = (data.outline || []).map(s => {
      let md = `## ${s.h2}\n\n`;
      if (s.h3) md += s.h3.map(h => `### ${h}\n\n`).join('');
      return md;
    }).join('');

    await fetch(`/api/articles/${lang}/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frontmatter: { title: data.title, slug, description: data.description, tags: data.tags, date: new Date().toISOString().split('T')[0] },
        markdown: outlineMd
      })
    });
    openArticle(lang, slug);
  }
}

async function createAndDraftFromOutline(lang) {
  const data = window._lastOutline;
  if (!data) return;

  const slug = slugify(data.title);
  const resultEl = document.getElementById('ai-outline-result');

  // Step 1: Create article (ignore 409 if already exists)
  resultEl.innerHTML = '<p style="color:var(--accent)">Creating article...</p>';
  const res = await fetch('/api/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, slug, title: data.title })
  });

  if (!res.ok && res.status !== 409) {
    const err = await res.json();
    resultEl.innerHTML = '<p style="color:var(--red)">Failed to create: ' + escHtml(err.error || '') + '</p>';
    return;
  }

  // Step 2: Save outline skeleton
  const outlineMd = (data.outline || []).map(s => {
    let md = `## ${s.h2}\n\n`;
    if (s.h3) md += s.h3.map(h => `### ${h}\n\n`).join('');
    return md;
  }).join('');

  const fm = { title: data.title, slug, description: data.description, tags: data.tags, date: new Date().toISOString().split('T')[0] };

  await fetch(`/api/articles/${lang}/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frontmatter: fm, markdown: outlineMd })
  });

  // Step 3: Generate full draft via AI
  resultEl.innerHTML = '<p style="color:var(--accent)">AI is writing the full article... (this takes 30-60 seconds)</p>';

  try {
    const draftRes = await fetch('/api/ai/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        outline: data.outline,
        lang,
        keyword: document.getElementById('idea-keyword').value
      })
    });
    const draftData = await draftRes.json();

    if (draftData.error) {
      resultEl.innerHTML = '<p style="color:var(--red)">AI error: ' + escHtml(draftData.error) + '</p><p style="color:var(--text-dim)">Outline saved — open article and click "AI Draft" in editor.</p><button class="btn btn-sm" onclick="openArticle(\'' + lang + '\',\'' + slug + '\')">Open Article</button>';
      return;
    }

    // Step 4: Save draft content
    await fetch(`/api/articles/${lang}/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frontmatter: fm, markdown: draftData.markdown })
    });

    resultEl.innerHTML = '<p style="color:var(--green)">Draft created! Opening editor...</p>';
    setTimeout(() => openArticle(lang, slug), 500);
    showToast('AI draft created!');
  } catch (err) {
    resultEl.innerHTML = '<p style="color:var(--red)">Error: ' + escHtml(err.message) + '</p><button class="btn btn-sm" onclick="openArticle(\'' + lang + '\',\'' + slug + '\')">Open Outline</button>';
  }
}

// ─── AI: Fix grammar & readability ───
async function aiFixGrammar() {
  if (!currentMarkdown) { alert('Open an article first'); return; }

  const lang = currentArticle?.lang || 'pl';
  const btn = document.getElementById('btn-ai-fix-grammar');
  const sidebar = document.getElementById('checker-results');
  btn.disabled = true; btn.textContent = 'Fixing...';
  sidebar.innerHTML = '<p style="color:var(--accent);font-weight:600;">Step 1/2: Checking grammar via LanguageTool...</p>';

  try {
    // Step 1: Get grammar issues from LanguageTool
    const plain = currentMarkdown
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`[^`]+`/g, '');

    const grammarRes = await fetch('/api/check/grammar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: plain, lang })
    });
    const grammarData = await grammarRes.json();

    const issues = (grammarData.matches || []).map(m => ({
      message: m.message,
      context: m.context.text.slice(Math.max(0, m.context.offset - 15), m.context.offset + m.context.length + 15),
      suggestion: m.replacements?.slice(0, 2).map(r => r.value).join(' or ') || ''
    }));

    if (issues.length === 0) {
      sidebar.innerHTML = '<p style="color:var(--green);font-weight:600;">No grammar issues found!</p>';
      btn.disabled = false; btn.textContent = 'AI Auto-Fix';
      return;
    }

    sidebar.innerHTML = '<p style="color:var(--accent);font-weight:600;">Step 2/2: AI is fixing ' + issues.length + ' issues... (30-60 sec)</p>';

    // Step 2: Send to AI for fixing
    const originalMd = currentMarkdown;
    console.log('[AI Fix] Sending', issues.length, 'issues, markdown length:', originalMd.length);

    const res = await fetch('/api/ai/fix-grammar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: currentMarkdown, issues, lang })
    });
    const data = await res.json();
    console.log('[AI Fix] Response:', data.error ? 'ERROR: ' + data.error : 'OK, length: ' + (data.markdown || '').length);
    if (data.error) throw new Error(data.error);

    if (!data.markdown || data.markdown.trim() === originalMd.trim()) {
      sidebar.innerHTML = '<p style="color:var(--yellow);font-weight:600;">AI returned identical text. Remaining issues may be false positives.</p>';
      btn.disabled = false; btn.textContent = 'AI Auto-Fix';
      return;
    }

    // Count changed lines
    const origLines = originalMd.split('\n');
    const newLines = data.markdown.split('\n');
    let changedLines = 0;
    for (let i = 0; i < Math.max(origLines.length, newLines.length); i++) {
      if ((origLines[i] || '') !== (newLines[i] || '')) changedLines++;
    }

    // Update editor
    document.getElementById('md-editor').value = data.markdown;
    currentMarkdown = data.markdown;
    onEditorInput();
    showToast('Fixed! ' + changedLines + ' lines changed');

    sidebar.innerHTML = '<p style="color:var(--green);font-weight:600;">AI changed ' + changedLines + ' lines (from ' + issues.length + ' issues). Run Check Grammar to verify.</p>';
    renderCheckerText();
  } catch (err) {
    sidebar.innerHTML = '<p style="color:var(--red)">Error: ' + escHtml(err.message) + '</p>';
  }

  btn.disabled = false; btn.textContent = 'AI Auto-Fix';
}

// ─── AI: Suggest description ───
async function aiSuggestDesc() {
  if (!currentArticle) { alert('Open an article first'); return; }
  const md = document.getElementById('md-editor').value;
  const title = document.getElementById('fm-title').value;
  const lang = currentArticle.lang;

  showToast('Generating description...');
  try {
    const res = await fetch('/api/ai/description', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: md, title, lang })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('fm-desc').value = data.description;
    updateSEOLive();
    showToast('Description updated!');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── AI: Write full draft ───
async function aiWriteDraft() {
  if (!currentArticle) { alert('Open an article first'); return; }
  const md = document.getElementById('md-editor').value;
  const title = document.getElementById('fm-title').value;
  const desc = document.getElementById('fm-desc').value;
  const lang = currentArticle.lang;

  // Parse existing outline from markdown
  const headings = md.match(/^#{2,3}\s+.+$/gm) || [];
  if (headings.length === 0) {
    alert('Add at least some H2/H3 headings as an outline first');
    return;
  }

  if (!confirm('AI will write a full draft based on the current headings. Existing content will be replaced. Continue?')) return;

  showToast('AI is writing... (15-30 sec)');

  const outline = [];
  let currentH2 = null;
  for (const h of headings) {
    if (h.startsWith('## ')) {
      if (currentH2) outline.push(currentH2);
      currentH2 = { h2: h.replace('## ', ''), h3: [] };
    } else if (h.startsWith('### ') && currentH2) {
      currentH2.h3.push(h.replace('### ', ''));
    }
  }
  if (currentH2) outline.push(currentH2);

  try {
    const res = await fetch('/api/ai/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: desc, outline, lang, keyword: title })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('md-editor').value = data.markdown;
    currentMarkdown = data.markdown;
    onEditorInput();
    showToast('Draft generated!');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── AI: Improve SEO ───
async function aiImproveSEO() {
  if (!currentArticle) { alert('Open an article first'); return; }

  // First run SEO check to get current issues
  const frontmatter = getFrontmatter();
  const markdown = document.getElementById('md-editor').value;

  showToast('Analyzing SEO issues...');

  try {
    const seoRes = await fetch('/api/seo/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frontmatter, markdown, lang: currentArticle.lang })
    });
    const seoData = await seoRes.json();

    const failedChecks = seoData.checks.filter(c => !c.pass);
    if (failedChecks.length === 0) {
      showToast('SEO is already great!');
      return;
    }

    const res = await fetch('/api/ai/improve-seo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown, frontmatter, seoChecks: seoData.checks, lang: currentArticle.lang })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Show suggestions in SEO panel
    const panel = document.getElementById('seo-panel');
    panel.classList.remove('hidden');
    document.getElementById('seo-score').textContent = seoData.score + '% → Fix:';
    document.getElementById('seo-score').style.color = 'var(--accent)';
    document.getElementById('seo-checks').innerHTML = (data.suggestions || []).map(s => `
      <div class="seo-check" style="flex-direction:column;align-items:flex-start;gap:0.3rem;">
        <span style="font-weight:600;color:var(--yellow);">${escHtml(s.check)}</span>
        <span style="font-size:0.8rem;">${escHtml(s.action)}</span>
        ${s.newText ? '<div style="margin-top:0.3rem;"><button class="btn btn-sm" onclick="applySEOFix(this)" data-field="' + escAttr(s.check) + '" data-text="' + escAttr(s.newText) + '">Apply: ' + escHtml(s.newText).slice(0,60) + '...</button></div>' : ''}
      </div>
    `).join('');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function applySEOFix(btn) {
  const field = btn.dataset.field;
  const text = btn.dataset.text;
  const lower = field.toLowerCase();

  if (lower.includes('title')) {
    document.getElementById('fm-title').value = text;
  } else if (lower.includes('desc')) {
    document.getElementById('fm-desc').value = text;
  }
  updateSEOLive();
  showToast('Applied!');
}

// ─── Keywords ───
let lastSerpData = null;

async function searchKeywords() {
  const query = document.getElementById('kw-query').value.trim();
  if (!query) return;
  const lang = document.getElementById('kw-lang').value;

  const btn = document.getElementById('btn-kw-search');
  btn.disabled = true; btn.textContent = 'Searching...';

  const resultsEl = document.getElementById('kw-results');
  resultsEl.classList.add('hidden');
  document.getElementById('kw-analysis').classList.add('hidden');

  try {
    const res = await fetch('/api/keywords/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, lang })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    lastSerpData = data;
    renderSerpResults(data);
    resultsEl.classList.remove('hidden');
  } catch (err) {
    document.getElementById('kw-serp').innerHTML = '<p style="color:var(--red)">Error: ' + escHtml(err.message) + '</p>';
    resultsEl.classList.remove('hidden');
  }

  btn.disabled = false; btn.textContent = 'Search';
}

function renderSerpResults(data) {
  // SERP Top 5
  const serpEl = document.getElementById('kw-serp');
  if (data.organic.length === 0) {
    serpEl.innerHTML = '<p style="color:var(--text-dim)">No organic results found.</p>';
  } else {
    serpEl.innerHTML = data.organic.map((r, i) => `
      <div class="serp-result">
        <div class="serp-position">${r.position || i + 1}</div>
        <div class="serp-content">
          <a href="${escHtml(r.link)}" target="_blank" class="serp-title">${escHtml(r.title)}</a>
          <div class="serp-url">${escHtml(r.link)}</div>
          <div class="serp-snippet">${escHtml(r.snippet)}</div>
        </div>
      </div>
    `).join('');
  }

  // People Also Ask
  const paaEl = document.getElementById('kw-paa');
  if (data.peopleAlsoAsk.length === 0) {
    paaEl.innerHTML = '<p style="color:var(--text-dim)">No PAA data.</p>';
  } else {
    paaEl.innerHTML = data.peopleAlsoAsk.map(q => `<div class="paa-item">${escHtml(q)}</div>`).join('');
  }

  // Autocomplete
  const acEl = document.getElementById('kw-autocomplete');
  if (data.autocomplete.length === 0) {
    acEl.innerHTML = '<p style="color:var(--text-dim)">No autocomplete data.</p>';
  } else {
    acEl.innerHTML = data.autocomplete.map(s => `<div class="paa-item">${escHtml(s)}</div>`).join('');
  }

  // Related Searches
  const relEl = document.getElementById('kw-related');
  if (data.relatedSearches.length === 0) {
    relEl.innerHTML = '<p style="color:var(--text-dim)">No related searches.</p>';
  } else {
    relEl.innerHTML = data.relatedSearches.map(q =>
      `<span class="kw-tag" onclick="document.getElementById('kw-query').value='${escAttr(q)}';searchKeywords()">${escHtml(q)}</span>`
    ).join('');
  }
}

async function analyzeKeyword() {
  if (!lastSerpData) { alert('Search for a keyword first'); return; }

  const query = document.getElementById('kw-query').value.trim();
  const lang = document.getElementById('kw-lang').value;

  const btn = document.getElementById('btn-kw-analyze');
  btn.disabled = true; btn.textContent = 'Analyzing...';

  const analysisEl = document.getElementById('kw-analysis');
  analysisEl.classList.remove('hidden');
  analysisEl.innerHTML = '<p style="color:var(--accent)">AI is analyzing SERP data... (10-20 sec)</p>';

  try {
    const res = await fetch('/api/keywords/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, lang, serp: lastSerpData })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    window._lastKwAnalysis = data;
    renderKwAnalysis(query, lang, data);
  } catch (err) {
    analysisEl.innerHTML = '<p style="color:var(--red)">Error: ' + escHtml(err.message) + '</p>';
  }

  btn.disabled = false; btn.textContent = 'AI Analyze';
}

function renderStars(count) {
  const max = 5;
  let html = '';
  for (let i = 0; i < max; i++) {
    html += i < count ? '<span class="kw-star filled">&#9733;</span>' : '<span class="kw-star">&#9734;</span>';
  }
  return html;
}

function renderKwAnalysis(query, lang, data) {
  const labels = {
    potential: 'Potencja\u0142',
    competition: 'Konkurencja',
    relevance: 'Dopasowanie do HealthDesk'
  };
  const analysisEl = document.getElementById('kw-analysis');
  analysisEl.innerHTML = `
    <div class="kw-analysis-card">
      <h3>AI Analysis</h3>
      <div class="kw-analysis-ratings">
        <div class="kw-rating-row">
          <span class="kw-rating-label">${labels.potential}:</span>
          <span class="kw-rating-stars">${renderStars(data.potential)}</span>
        </div>
        <div class="kw-rating-row">
          <span class="kw-rating-label">${labels.competition}:</span>
          <span class="kw-rating-stars">${renderStars(data.competition)}</span>
        </div>
        <div class="kw-rating-row">
          <span class="kw-rating-label">${labels.relevance}:</span>
          <span class="kw-rating-stars">${renderStars(data.relevance)}</span>
        </div>
      </div>
      ${data.suggestedTitle ? '<div class="kw-suggestion"><strong>Sugerowany tytu\u0142:</strong> ' + escHtml(data.suggestedTitle) + '</div>' : ''}
      ${data.suggestedAngle ? '<div class="kw-suggestion"><strong>Sugerowany angle:</strong> ' + escHtml(data.suggestedAngle) + '</div>' : ''}
      ${data.notes ? '<div class="kw-suggestion"><strong>Uwagi:</strong> ' + escHtml(data.notes) + '</div>' : ''}
      <div class="kw-analysis-actions">
        <button class="btn btn-primary btn-sm" onclick="createFromKeyword()">Create Article from Keyword</button>
      </div>
    </div>
  `;
}

function createFromKeyword() {
  const query = document.getElementById('kw-query').value.trim();
  const lang = document.getElementById('kw-lang').value;
  const analysis = window._lastKwAnalysis;

  // Add to Idea Board with SERP context
  const notes = analysis
    ? `AI: ${analysis.suggestedAngle || ''} | Potencjał: ${analysis.potential}/5, Konkurencja: ${analysis.competition}/5`
    : '';

  fetch('/api/ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyword: analysis?.suggestedTitle || query,
      lang,
      notes,
      serpScore: analysis ? { potential: analysis.potential, competition: analysis.competition, relevance: analysis.relevance } : null
    })
  }).then(() => {
    showToast('Added to Idea Board!');
    switchView('ideas');
  });
}

// ─── Init ───
loadDashboard();
