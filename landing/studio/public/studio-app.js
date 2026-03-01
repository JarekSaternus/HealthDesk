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
  document.getElementById('fm-keyword').value = data.frontmatter.keyword || '';
  document.getElementById('fm-lang').value = lang;
  document.getElementById('editor-title').textContent = data.frontmatter.title || slug;

  // Editor
  document.getElementById('md-editor').value = data.markdown;
  document.getElementById('md-preview').innerHTML = data.html;

  updateSEOLive();
  loadHeroImage(slug);
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
    keyword: document.getElementById('fm-keyword').value.trim(),
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
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

  // Step 3: Generate full draft via AI (chunked — multiple AI calls)
  const chunkCount = Math.ceil((data.outline || []).length / 2);
  resultEl.innerHTML = '<p style="color:var(--accent)">AI is writing the full article in ' + chunkCount + ' chunks... (this takes ' + (chunkCount * 20) + '-' + (chunkCount * 40) + ' seconds)</p>';

  try {
    const draftRes = await fetch('/api/ai/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        outline: data.outline,
        lang,
        keyword: document.getElementById('idea-keyword').value,
        slug
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

// ─── AI: Humanize article ───
async function aiHumanize() {
  if (!currentMarkdown) { alert('Open an article first'); return; }

  const lang = currentArticle?.lang || 'pl';
  const btn = document.getElementById('btn-ai-humanize');
  const sidebar = document.getElementById('checker-results');
  btn.disabled = true; btn.textContent = 'Humanizing...';
  sidebar.innerHTML = '<p style="color:#8b5cf6;font-weight:600;">Humanizing article — removing AI patterns... (30-60 sec)</p>';

  try {
    const originalMd = currentMarkdown;
    const res = await fetch('/api/ai/humanize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: currentMarkdown, lang })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (!data.markdown || data.markdown.trim() === originalMd.trim()) {
      sidebar.innerHTML = '<p style="color:var(--yellow);font-weight:600;">No changes made.</p>';
      btn.disabled = false; btn.textContent = 'Humanize';
      return;
    }

    // Extract diagnosis comment if present
    let articleText = data.markdown;
    let diagnosisHtml = '';
    const diagMatch = articleText.match(/<!--\s*DIAGNOSIS:\s*([\s\S]*?)-->/);
    if (diagMatch) {
      const diagText = diagMatch[1].trim().replace(/\n/g, '<br>');
      diagnosisHtml = '<div style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);border-radius:8px;padding:12px;margin-bottom:12px;font-size:0.85rem;color:var(--text-secondary);"><strong style="color:#8b5cf6;">AI Diagnosis:</strong><br>' + diagText + '</div>';
      articleText = articleText.replace(/<!--\s*DIAGNOSIS:\s*[\s\S]*?-->\s*/, '').trim();
    }

    const origLines = originalMd.split('\n');
    const newLines = articleText.split('\n');
    let changedLines = 0;
    for (let i = 0; i < Math.max(origLines.length, newLines.length); i++) {
      if ((origLines[i] || '') !== (newLines[i] || '')) changedLines++;
    }

    document.getElementById('md-editor').value = articleText;
    currentMarkdown = articleText;
    onEditorInput();
    showToast('Humanized! ' + changedLines + ' lines changed');

    sidebar.innerHTML = diagnosisHtml + '<p style="color:#8b5cf6;font-weight:600;">Humanized: ' + changedLines + ' lines changed. Review the result and save if satisfied.</p>';
    renderCheckerText();
  } catch (err) {
    sidebar.innerHTML = '<p style="color:var(--red)">Error: ' + escHtml(err.message) + '</p>';
  }

  btn.disabled = false; btn.textContent = 'Humanize';
}

// ─── AI: Audit article for AI patterns ───
async function aiAudit() {
  if (!currentMarkdown) { alert('Open an article first'); return; }

  const lang = currentArticle?.lang || 'pl';
  const btn = document.getElementById('btn-ai-audit');
  const sidebar = document.getElementById('checker-results');
  btn.disabled = true; btn.textContent = 'Checking...';
  sidebar.innerHTML = '<p style="color:#f59e0b;font-weight:600;">Analyzing article for AI patterns... (15-30 sec)</p>';

  try {
    const res = await fetch('/api/ai/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: currentMarkdown, lang })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const score = data.score || 0;
    const scoreColor = score <= 3 ? 'var(--green)' : score <= 6 ? '#f59e0b' : 'var(--red)';
    const scoreLabel = score <= 3 ? 'Human' : score <= 6 ? 'Mixed' : 'AI-like';

    let html = '<div style="text-align:center;margin-bottom:16px;">';
    html += '<div style="font-size:2.5rem;font-weight:800;color:' + scoreColor + ';">' + score + '/10</div>';
    html += '<div style="font-size:0.85rem;color:' + scoreColor + ';font-weight:600;">' + scoreLabel + '</div>';
    html += '</div>';

    // Dimensions
    if (data.dimensions && data.dimensions.length > 0) {
      html += '<div style="margin-bottom:12px;">';
      for (const dim of data.dimensions) {
        const barW = (dim.score / 10) * 100;
        const dimColor = dim.score <= 3 ? 'var(--green)' : dim.score <= 6 ? '#f59e0b' : 'var(--red)';
        html += '<div style="margin-bottom:6px;font-size:0.8rem;">';
        html += '<div style="display:flex;justify-content:space-between;margin-bottom:2px;"><span style="color:var(--text-secondary);">' + escHtml(dim.name) + '</span><span style="color:' + dimColor + ';font-weight:600;">' + dim.score + '</span></div>';
        html += '<div style="background:rgba(255,255,255,0.06);border-radius:4px;height:4px;overflow:hidden;"><div style="width:' + barW + '%;height:100%;background:' + dimColor + ';border-radius:4px;"></div></div>';
        if (dim.detail) html += '<div style="font-size:0.75rem;color:var(--text-dim);margin-top:2px;">' + escHtml(dim.detail) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Top problems
    if (data.top_problems && data.top_problems.length > 0) {
      html += '<div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;"><strong style="color:var(--text-primary);font-size:0.85rem;">Problems & Fixes:</strong>';
      for (const p of data.top_problems) {
        html += '<div style="margin:8px 0;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:0.8rem;">';
        html += '<div style="color:var(--red);font-weight:600;">' + escHtml(p.problem) + '</div>';
        if (p.quote) html += '<div style="color:var(--text-dim);font-style:italic;margin:2px 0;">"' + escHtml(p.quote).slice(0, 100) + '"</div>';
        if (p.fix) html += '<div style="color:var(--green);margin-top:2px;">Fix: ' + escHtml(p.fix) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Summary
    if (data.summary) {
      html += '<div style="margin-top:10px;padding:8px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:6px;font-size:0.8rem;color:var(--text-secondary);">' + escHtml(data.summary) + '</div>';
    }

    sidebar.innerHTML = html;
  } catch (err) {
    sidebar.innerHTML = '<p style="color:var(--red)">Error: ' + escHtml(err.message) + '</p>';
  }

  btn.disabled = false; btn.textContent = 'AI Check';
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

  const persona = prompt('Optional: Write from which perspective? (e.g. "physiotherapist", "IT expert", "productivity coach")\nLeave empty for default.', '') || '';

  if (!confirm('AI will write a full draft based on the current headings. Existing content will be replaced. Continue?')) return;

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

  const chunkCount = Math.ceil(outline.length / 2);

  // Show persistent progress banner in preview pane
  showDraftProgress({ status: 'generating', chunk: 0, totalChunks: chunkCount, sections: 'Starting...', words: 0 });

  // Start polling for progress
  const pollId = startDraftPolling();

  const editorEl = document.getElementById('md-editor');
  editorEl.disabled = true;

  try {
    const res = await fetch('/api/ai/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: desc, outline, lang, keyword: title, slug: currentArticle.slug, persona })
    });
    const data = await res.json();
    stopDraftPolling(pollId);
    if (data.error) throw new Error(data.error);

    document.getElementById('md-editor').value = data.markdown;
    currentMarkdown = data.markdown;
    onEditorInput();
    showDraftProgress({ status: 'done', words: data.markdown.split(/\s+/).length, totalChunks: chunkCount, chunk: chunkCount });
  } catch (err) {
    stopDraftPolling(pollId);
    showDraftProgress({ status: 'error', error: err.message });
  }
  editorEl.disabled = false;
}

// ─── Draft progress UI ───
let _draftPollInterval = null;

function showDraftProgress(p) {
  const previewEl = document.getElementById('md-preview');
  if (!previewEl) return;

  if (p.status === 'idle' || !p.status) return;

  if (p.status === 'generating') {
    const elapsed = p.startedAt ? Math.round((Date.now() - p.startedAt) / 1000) : 0;
    const pct = p.totalChunks ? Math.round((Math.max(0, p.chunk - 1) / p.totalChunks) * 100) : 0;
    const barWidth = p.totalChunks ? Math.round(((p.chunk - 0.5) / p.totalChunks) * 100) : 5;
    previewEl.innerHTML = `
      <div style="padding:2rem;text-align:center;">
        <div style="font-size:1.2rem;font-weight:600;color:var(--accent);margin-bottom:0.75rem;">
          ✍️ AI is writing the article...
        </div>
        <div style="background:var(--bg-sidebar);border-radius:8px;height:8px;max-width:400px;margin:0 auto 1rem;">
          <div style="background:var(--accent);height:100%;border-radius:8px;width:${barWidth}%;transition:width 0.5s;"></div>
        </div>
        <div style="font-size:0.95rem;color:var(--text);margin-bottom:0.4rem;">
          Chunk <strong>${p.chunk}</strong> / ${p.totalChunks}
        </div>
        <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.3rem;">
          ${p.sections ? 'Writing: ' + escHtml(p.sections) : ''}
        </div>
        <div style="font-size:0.8rem;color:var(--text-dim);">
          ${p.words ? p.words + ' words so far' : ''}
          ${elapsed ? ' · ' + elapsed + 's elapsed' : ''}
        </div>
      </div>`;
  } else if (p.status === 'done') {
    previewEl.innerHTML = `
      <div style="padding:2rem;text-align:center;">
        <div style="font-size:1.2rem;font-weight:600;color:var(--green);margin-bottom:0.5rem;">
          ✅ Draft complete!
        </div>
        <div style="font-size:0.9rem;color:var(--text-dim);">
          ${p.words || '?'} words · ${p.totalChunks || '?'} chunks
        </div>
      </div>`;
    // Auto-refresh preview after 2s
    setTimeout(() => {
      const md = document.getElementById('md-editor').value;
      if (md) previewEl.innerHTML = simpleMarkdown(md);
    }, 2000);
  } else if (p.status === 'error') {
    previewEl.innerHTML = '<div style="padding:2rem;color:var(--red);text-align:center;">Error: ' + escHtml(p.error || 'Unknown') + '</div>';
  }
}

function startDraftPolling() {
  stopDraftPolling();
  _draftPollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/ai/draft/status');
      const p = await res.json();
      if (p.status === 'generating') showDraftProgress(p);
    } catch {}
  }, 2000);
  return _draftPollInterval;
}

function stopDraftPolling(id) {
  if (_draftPollInterval) { clearInterval(_draftPollInterval); _draftPollInterval = null; }
  if (id) clearInterval(id);
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
    document.getElementById('seo-checks').innerHTML = (data.suggestions || []).map(s => {
      const lower = (s.check || '').toLowerCase();
      const canApply = s.newText && (lower.includes('title') || lower.includes('desc'));
      const isTranslation = lower.includes('translation') || lower.includes('sibling') || lower.includes('hreflang');
      let actionHtml = '';
      if (canApply) {
        actionHtml = '<div style="margin-top:0.3rem;"><button class="btn btn-sm" onclick="applySEOFix(this)" data-field="' + escAttr(s.check) + '" data-text="' + escAttr(s.newText) + '">Apply: ' + escHtml(s.newText).slice(0,60) + '...</button></div>';
      } else if (isTranslation && currentArticle) {
        const targetLang = currentArticle.lang === 'en' ? 'pl' : 'en';
        const targetLabel = targetLang.toUpperCase();
        actionHtml = '<div style="margin-top:0.3rem;"><button class="btn btn-sm" style="background:var(--accent);color:#000;" onclick="createLangVersion(\'' + targetLang + '\')">Create ' + targetLabel + ' Version</button></div>';
      }
      return `
      <div class="seo-check" style="flex-direction:column;align-items:flex-start;gap:0.3rem;">
        <span style="font-weight:600;color:var(--yellow);">${escHtml(s.check)}</span>
        <span style="font-size:0.8rem;">${escHtml(s.action)}</span>
        ${actionHtml}
      </div>`;
    }).join('');
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

// ─── AI: Internal Linking Suggestions ───
async function aiInternalLinks() {
  if (!currentArticle) { alert('Open an article first'); return; }

  showToast('Analyzing internal linking opportunities...');

  try {
    const res = await fetch('/api/ai/internal-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: currentArticle.lang, slug: currentArticle.slug })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const suggestions = data.suggestions || [];
    if (suggestions.length === 0) {
      showToast('No linking opportunities found');
      return;
    }

    const panel = document.getElementById('seo-panel');
    panel.classList.remove('hidden');
    document.getElementById('seo-score').textContent = '🔗 Internal Links';
    document.getElementById('seo-score').style.color = 'var(--accent)';
    document.getElementById('seo-checks').innerHTML = `<div style="margin-bottom:0.5rem;"><button class="btn btn-sm" style="background:var(--accent);color:#000;" onclick="applyAllInternalLinks()">Insert All (${suggestions.length})</button></div>` + suggestions.map((s, i) => `
      <div class="seo-check" style="flex-direction:column;align-items:flex-start;gap:0.3rem;">
        <span style="font-weight:600;color:var(--yellow);">"${escHtml(s.anchor)}" → ${escHtml(s.targetTitle)}</span>
        <span style="font-size:0.8rem;">${escHtml(s.reason)}</span>
        <button class="btn btn-sm" style="margin-top:0.3rem;" onclick="applyInternalLink(this)" data-anchor="${escAttr(s.anchor)}" data-url="${escAttr(s.url)}">Insert Link</button>
      </div>`).join('');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function applyAllInternalLinks() {
  const btns = document.querySelectorAll('#seo-checks button[data-anchor]');
  let count = 0;
  btns.forEach(btn => {
    if (!btn.disabled) {
      applyInternalLink(btn);
      count++;
    }
  });
  showToast(`Inserted ${count} links!`);
}

function applyInternalLink(btn) {
  const anchor = btn.dataset.anchor;
  const url = btn.dataset.url;
  const editor = document.getElementById('md-editor');
  const md = editor.value;
  const idx = md.indexOf(anchor);
  if (idx === -1) { showToast('Phrase not found in text'); return; }

  // Replace first occurrence only
  editor.value = md.substring(0, idx) + '[' + anchor + '](' + url + ')' + md.substring(idx + anchor.length);
  onEditorInput();
  btn.disabled = true;
  btn.textContent = 'Inserted ✓';
  btn.style.opacity = '0.5';
  showToast('Link inserted!');
}

// ─── Hero image management ───
async function loadHeroImage(slug) {
  const panel = document.getElementById('hero-panel');
  panel.classList.remove('hidden');
  try {
    const res = await fetch(`/api/hero-image/${slug}`);
    const data = await res.json();
    updateHeroPanel(data);
  } catch {
    updateHeroPanel({ exists: false });
  }
}

function updateHeroPanel(data) {
  const img = document.getElementById('hero-img');
  const badge = document.getElementById('hero-badge');
  const size = document.getElementById('hero-size');
  const btnDelete = document.getElementById('hero-btn-delete');
  const btnGenerate = document.getElementById('hero-btn-generate');

  if (data.exists) {
    img.src = `/api/preview-image/${data.filename}?t=${Date.now()}`;
    img.classList.add('loaded');
    badge.textContent = 'Hero image';
    badge.className = 'hero-badge has-image';
    size.textContent = data.size + ' · WebP 1200×630';
    btnDelete.style.display = '';
    btnGenerate.textContent = 'Regenerate';
  } else {
    img.src = '';
    img.classList.remove('loaded');
    badge.textContent = 'No image';
    badge.className = 'hero-badge';
    size.textContent = '';
    btnDelete.style.display = 'none';
    btnGenerate.textContent = 'Generate';
  }
}

async function deleteHeroImage() {
  if (!currentArticle) return;
  if (!confirm('Delete hero image?')) return;
  await fetch(`/api/hero-image/${currentArticle.slug}`, { method: 'DELETE' });
  updateHeroPanel({ exists: false });
  showToast('Hero image deleted');
}

async function generateHeroImage() {
  if (!currentArticle) { alert('Open an article first'); return; }

  const frontmatter = getFrontmatter();
  const btnGenerate = document.getElementById('hero-btn-generate');
  const origText = btnGenerate.textContent;
  btnGenerate.disabled = true;
  btnGenerate.textContent = 'Generating...';
  showToast('Generating hero image... (15-30s)');

  try {
    const res = await fetch('/api/ai/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: currentArticle.slug,
        lang: currentArticle.lang,
        title: frontmatter.title,
        description: frontmatter.description,
        style: 'clean, modern, professional, wellness'
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Image generated! (${data.size})`);
    updateHeroPanel({ exists: true, filename: data.filename, size: data.size });
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.textContent = origText;
  }
}

// ─── Create language version ───
async function createLangVersion(targetLang) {
  if (!currentArticle) { alert('Open an article first'); return; }

  const targetLabel = targetLang.toUpperCase();
  const frontmatter = getFrontmatter();
  if (!confirm(`Create ${targetLabel} version of "${frontmatter.title}"?\n\nThis will generate a new SEO-optimized article in ${targetLabel} (not a direct translation).`)) return;
  const markdown = document.getElementById('md-editor').value;

  showToast(`Generating ${targetLabel} version... This may take 30-60s`);

  try {
    const res = await fetch('/api/ai/create-version', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceLang: currentArticle.lang,
        targetLang,
        slug: currentArticle.slug,
        frontmatter,
        markdown
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`${targetLabel} version created! (${data.wordCount} words)`);

    // Ask if user wants to open the new article
    if (confirm(`${targetLabel} version created:\n"${data.title}"\nSlug: ${data.slug}\n\n${data.wordCount} words. Open it now?`)) {
      await loadDashboard();
      openArticle(targetLang, data.slug);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
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

// Check if AI draft is in progress (e.g. after page refresh)
(async function checkDraftOnLoad() {
  try {
    const res = await fetch('/api/ai/draft/status');
    const p = await res.json();
    if (p.status === 'generating') {
      // Draft is running — switch to editor and show progress
      switchView('editor');
      document.getElementById('editor-title').textContent = p.title || 'Generating...';
      document.getElementById('md-editor').disabled = true;
      showDraftProgress(p);
      // Start polling until done
      const pollId = setInterval(async () => {
        try {
          const r = await fetch('/api/ai/draft/status');
          const s = await r.json();
          showDraftProgress(s);
          if (s.status === 'done') {
            clearInterval(pollId);
            document.getElementById('md-editor').disabled = false;
            showToast('Draft finished! Reload article to see content.');
            // Try to open the article
            if (s.slug && s.lang) {
              setTimeout(() => openArticle(s.lang, s.slug), 1500);
            }
          } else if (s.status === 'error' || s.status === 'idle') {
            clearInterval(pollId);
            document.getElementById('md-editor').disabled = false;
          }
        } catch { clearInterval(pollId); }
      }, 2000);
    }
  } catch {}
})();

// ─── GSC Indexing Panel ───
async function gscRefresh() {
  const tbody = document.getElementById('gsc-tbody');
  const statsEl = document.getElementById('gsc-stats');

  try {
    const res = await fetch('/api/gsc/status');
    const data = await res.json();

    if (!data.configured) {
      statsEl.innerHTML = `<div class="gsc-error">⚠️ ${data.error || 'GSC nie skonfigurowane'}</div>`;
      tbody.innerHTML = '';
      return;
    }

    if (data.error) {
      statsEl.innerHTML = `<div class="gsc-error">⚠️ ${data.error}</div>`;
      tbody.innerHTML = '';
      return;
    }

    const s = data.stats;
    statsEl.innerHTML = `
      <div class="gsc-stat gsc-stat-ok"><span class="gsc-stat-val">${s.ok}</span><span class="gsc-stat-label">Zgłoszone</span></div>
      <div class="gsc-stat gsc-stat-new"><span class="gsc-stat-val">${s.new}</span><span class="gsc-stat-label">Nowe</span></div>
      <div class="gsc-stat gsc-stat-changed"><span class="gsc-stat-val">${s.changed}</span><span class="gsc-stat-label">Zmienione</span></div>
      <div class="gsc-stat"><span class="gsc-stat-val">${s.total}</span><span class="gsc-stat-label">Razem</span></div>
    `;

    tbody.innerHTML = data.urls.map(u => {
      const icon = u.status === 'ok' ? '✅' : u.status === 'new' ? '🆕' : '🔄';
      const statusClass = 'gsc-status-' + u.status;
      const shortUrl = u.url.replace('https://healthdesk.site', '');
      const notified = u.notifiedAt ? new Date(u.notifiedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
      return `<tr class="${statusClass}">
        <td class="gsc-url" title="${u.url}">${shortUrl}</td>
        <td>${u.lastmod || '—'}</td>
        <td>${notified}</td>
        <td>${icon}</td>
      </tr>`;
    }).join('');

    // Disable submit button if nothing to submit
    const submitBtn = document.getElementById('btn-gsc-submit');
    if (s.new === 0 && s.changed === 0) {
      submitBtn.textContent = 'Wszystko aktualne ✓';
      submitBtn.disabled = true;
    } else {
      submitBtn.textContent = `Zgłoś nowe do Google (${s.new + s.changed})`;
      submitBtn.disabled = false;
    }

  } catch (err) {
    statsEl.innerHTML = `<div class="gsc-error">❌ Błąd: ${err.message}</div>`;
  }
}

async function gscSubmitNew() {
  const btn = document.getElementById('btn-gsc-submit');
  btn.disabled = true;
  btn.textContent = 'Wysyłanie...';

  try {
    const res = await fetch('/api/gsc/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();

    if (data.message) {
      showToast(data.message);
    } else if (data.submitted === 0 && data.errors > 0) {
      const firstErr = data.results?.find(r => r.error)?.error || 'Nieznany błąd';
      showToast(`❌ Błąd GSC: ${firstErr}`, 'error');
    } else {
      const errors = data.errors || 0;
      showToast(`Zgłoszono ${data.submitted} URL-ów${errors ? `, ${errors} błędów` : ''}`);
    }
    gscRefresh();
  } catch (err) {
    showToast('Błąd: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Zgłoś nowe do Google';
  }
}

async function gscSubmitAll() {
  const btn = document.getElementById('btn-gsc-all');
  btn.disabled = true;
  btn.textContent = 'Wysyłanie wszystkich...';

  try {
    // Get all URLs from current status
    const statusRes = await fetch('/api/gsc/status');
    const statusData = await statusRes.json();
    if (!statusData.urls) { showToast('Brak URL-i'); return; }

    const allUrls = statusData.urls.map(u => u.url);
    const res = await fetch('/api/gsc/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: allUrls })
    });
    const data = await res.json();
    showToast(`Zgłoszono ${data.submitted} URL-ów`);
    gscRefresh();
  } catch (err) {
    showToast('Błąd: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Zgłoś wszystkie';
  }
}

// Load GSC status when Build & Deploy view is opened
const origSwitchView = switchView;
switchView = function(view) {
  origSwitchView(view);
  if (view === 'build') gscRefresh();
  if (view === 'keywords') loadTrackedKeywords();
};

// ─── Keyword Rank Tracker ───

function switchKwTab(tab) {
  document.querySelectorAll('.kw-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.kw-subtab').forEach(s => s.style.display = 'none');
  document.getElementById('kw-tab-' + tab).style.display = '';
  event.target.classList.add('active');
  if (tab === 'tracker') loadTrackedKeywords();
  if (tab === 'gsc') loadGscAnalytics();
  if (tab === 'structure') loadSiteStructure();
}

async function loadTrackedKeywords() {
  const tbody = document.getElementById('tracker-tbody');
  try {
    const res = await fetch('/api/keywords/tracked');
    const keywords = await res.json();

    if (keywords.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:2rem;">Brak śledzonych keywords. Kliknij "+ Dodaj keyword" żeby zacząć.</td></tr>';
      document.getElementById('tracker-cannibalization').classList.add('hidden');
      return;
    }

    // Populate target URL dropdown
    populateTargetDropdown();

    // Find last check date
    let lastCheck = null;
    for (const kw of keywords) {
      if (kw.history.length) {
        const d = kw.history[kw.history.length - 1].date;
        if (!lastCheck || d > lastCheck) lastCheck = d;
      }
    }
    document.getElementById('tracker-last-check').textContent = lastCheck
      ? `Ostatnie sprawdzenie: ${lastCheck}`
      : 'Jeszcze nie sprawdzono';

    // Render table
    tbody.innerHTML = keywords.map(kw => {
      const latest = kw.history.length ? kw.history[kw.history.length - 1] : null;
      const prev = kw.history.length > 1 ? kw.history[kw.history.length - 2] : null;

      // Position
      const pos = latest?.position;
      const posText = pos ? `#${pos}` : '—';
      const posClass = !pos ? 'tk-pos-none' : pos <= 10 ? 'tk-pos-good' : pos <= 30 ? 'tk-pos-mid' : 'tk-pos-low';

      // Change
      let changeHtml = '<span class="tk-change-same">—</span>';
      if (pos && prev?.position) {
        const diff = prev.position - pos; // positive = improved
        if (diff > 0) changeHtml = `<span class="tk-change-up">↑${diff}</span>`;
        else if (diff < 0) changeHtml = `<span class="tk-change-down">↓${Math.abs(diff)}</span>`;
        else changeHtml = '<span class="tk-change-same">→</span>';
      }

      // Sparkline (last 8 data points)
      const sparkData = kw.history.slice(-8).map(h => h.position || 100);
      const sparkMax = Math.max(...sparkData, 1);
      const sparkHtml = sparkData.map(p => {
        const height = Math.max(2, Math.round((1 - (p - 1) / sparkMax) * 20));
        const color = p <= 10 ? '#2ecc71' : p <= 30 ? '#f1c40f' : p >= 100 ? '#555' : '#e67e22';
        return `<div class="tk-sparkline-bar" style="height:${height}px;background:${color}"></div>`;
      }).join('');

      // Status
      const isCannibalization = latest?.cannibalization;
      const statusHtml = !latest ? '⏳' :
        isCannibalization ? '⚠️ Kanibalizacja' :
        pos ? '✅' : '❌ Brak';

      const rowClass = isCannibalization ? 'tk-cannibalization' : '';
      // Show readable page name instead of truncated URL
      let targetLabel = '—';
      if (kw.targetPage) {
        targetLabel = kw.targetPage;
      } else if (kw.targetUrl) {
        const u = kw.targetUrl.replace('https://healthdesk.site/', '');
        if (u.includes('/blog/')) {
          targetLabel = u.split('/blog/')[0].toUpperCase() + ' Blog: ' + u.split('/blog/')[1].replace(/\/$/, '');
        } else {
          targetLabel = u.replace(/\/$/, '') || 'Home';
        }
      }

      return `<tr class="${rowClass}">
        <td class="tk-keyword">${escHtml(kw.keyword)}</td>
        <td>${kw.lang.toUpperCase()}</td>
        <td class="tk-target" title="${kw.targetUrl || ''}">${escHtml(targetLabel)}</td>
        <td class="tk-position ${posClass}">${posText}</td>
        <td>${changeHtml}</td>
        <td><div class="tk-sparkline">${sparkHtml}</div></td>
        <td>${statusHtml}</td>
        <td><button class="btn-close" title="Usuń" onclick="removeTrackedKeyword('${kw.id}')">&times;</button></td>
      </tr>`;
    }).join('');

    // Cannibalization alerts
    checkCannibalization();

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:#e74c3c">Błąd: ${err.message}</td></tr>`;
  }
}

async function populateTargetDropdown() {
  const select = document.getElementById('tk-target');
  if (select.options.length > 1) return; // already populated

  try {
    const res = await fetch('/api/gsc/status');
    const data = await res.json();
    if (data.urls) {
      data.urls.forEach(u => {
        const opt = document.createElement('option');
        const short = u.url.replace('https://healthdesk.site', '');
        opt.value = short;
        opt.textContent = short;
        select.appendChild(opt);
      });
    }
  } catch {}
}

function showAddKeywordForm() {
  const form = document.getElementById('tracker-add-form');
  form.classList.remove('hidden');
  document.getElementById('tk-keyword').focus();
  populateTargetDropdown();
}

async function addTrackedKeyword() {
  const keyword = document.getElementById('tk-keyword').value.trim();
  const lang = document.getElementById('tk-lang').value;
  const targetUrl = document.getElementById('tk-target').value;
  if (!keyword) return;

  // Determine target page name
  let targetPage = targetUrl || '';
  if (targetUrl.includes('/blog/')) {
    targetPage = 'Blog: ' + targetUrl.split('/blog/')[1].replace(/\/$/, '');
  } else if (targetUrl.match(/^\/[a-z]{2}\/$/)) {
    targetPage = 'Landing ' + targetUrl.replace(/\//g, '').toUpperCase();
  }

  try {
    const res = await fetch('/api/keywords/tracked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, lang, targetUrl, targetPage })
    });
    const data = await res.json();
    if (data.error) { showToast(data.error); return; }

    document.getElementById('tk-keyword').value = '';
    document.getElementById('tracker-add-form').classList.add('hidden');
    showToast(`Keyword "${keyword}" dodany`);
    loadTrackedKeywords();
  } catch (err) {
    showToast('Błąd: ' + err.message);
  }
}

async function removeTrackedKeyword(id) {
  if (!confirm('Usunąć ten keyword z trackera?')) return;
  try {
    await fetch(`/api/keywords/tracked/${id}`, { method: 'DELETE' });
    loadTrackedKeywords();
  } catch (err) {
    showToast('Błąd: ' + err.message);
  }
}

async function seedExistingKeywords() {
  const btn = document.getElementById('btn-seed-kw');
  btn.disabled = true;
  btn.textContent = 'Seeduję...';
  try {
    const r = await fetch('/api/keywords/seed-existing', { method: 'POST' });
    const data = await r.json();
    if (data.ok) {
      showToast(`Dodano ${data.added} keywords z istniejących artykułów i landing pages`, 'success');
      loadTrackedKeywords();
    } else {
      showToast('Błąd: ' + (data.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Błąd: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = 'Seed istniejące';
}

// ─── GSC Analytics ───

let gscCurrentView = 'queries';

function switchGscView(view) {
  gscCurrentView = view;
  document.querySelectorAll('.gsc-view-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.gsc-table-wrap[id^="gsc-view-"]').forEach(el => el.style.display = 'none');
  document.getElementById('gsc-view-' + view).style.display = '';
  if (view === 'discover') loadGscDiscover();
}

async function loadGscAnalytics() {
  const days = document.getElementById('gsc-period').value;
  const msgEl = document.getElementById('gsc-message');
  const summaryEl = document.getElementById('gsc-summary');
  msgEl.innerHTML = '<span class="gsc-loading">Ładowanie danych z Google Search Console...</span>';
  summaryEl.innerHTML = '';

  try {
    // Load queries and pages in parallel
    const [qRes, pRes] = await Promise.all([
      fetch(`/api/gsc/analytics?days=${days}&type=query`),
      fetch(`/api/gsc/analytics?days=${days}&type=page`)
    ]);
    const qData = await qRes.json();
    const pData = await pRes.json();

    if (!qData.configured) {
      msgEl.innerHTML = '<span class="gsc-error">Brak konfiguracji GSC (gsc-key.json)</span>';
      return;
    }

    if (qData.error) {
      msgEl.innerHTML = `<span class="gsc-error">${escHtml(qData.error)}</span>`;
      return;
    }

    // Summary
    const totalClicks = qData.rows.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = qData.rows.reduce((s, r) => s + r.impressions, 0);
    const avgCtr = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 1000) / 10 : 0;
    const avgPos = qData.rows.length > 0 ? Math.round(qData.rows.reduce((s, r) => s + r.position, 0) / qData.rows.length * 10) / 10 : 0;

    if (qData.rows.length === 0 && pData.rows.length === 0) {
      msgEl.innerHTML = `<span class="gsc-info">Brak danych za ostatnie ${days} dni. Strona jest świeża — dane pojawią się za 2-3 dni po zaindeksowaniu.</span>`;
      summaryEl.innerHTML = '';
      document.getElementById('gsc-queries-tbody').innerHTML = '';
      document.getElementById('gsc-pages-tbody').innerHTML = '';
      return;
    }

    msgEl.innerHTML = `<span class="gsc-period-label">${qData.period}</span>`;

    summaryEl.innerHTML = `
      <div class="gsc-stat-card">
        <div class="gsc-stat-value">${totalClicks}</div>
        <div class="gsc-stat-label">Kliknięcia</div>
      </div>
      <div class="gsc-stat-card">
        <div class="gsc-stat-value">${totalImpressions}</div>
        <div class="gsc-stat-label">Wyświetlenia</div>
      </div>
      <div class="gsc-stat-card">
        <div class="gsc-stat-value">${avgCtr}%</div>
        <div class="gsc-stat-label">Śr. CTR</div>
      </div>
      <div class="gsc-stat-card">
        <div class="gsc-stat-value">${avgPos}</div>
        <div class="gsc-stat-label">Śr. pozycja</div>
      </div>
    `;

    // Queries table
    document.getElementById('gsc-queries-tbody').innerHTML = qData.rows
      .sort((a, b) => b.impressions - a.impressions)
      .map(r => {
        const posClass = r.position <= 10 ? 'tk-pos-good' : r.position <= 30 ? 'tk-pos-mid' : 'tk-pos-low';
        return `<tr>
          <td class="tk-keyword">${escHtml(r.key)}</td>
          <td>${r.clicks}</td>
          <td>${r.impressions}</td>
          <td>${r.ctr}%</td>
          <td class="${posClass}">${r.position}</td>
          <td><button class="btn btn-xs" onclick="trackFromGsc('${escHtml(r.key)}')" title="Dodaj do Rank Tracker">+Track</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" class="text-center">Brak danych</td></tr>';

    // Pages table
    document.getElementById('gsc-pages-tbody').innerHTML = pData.rows
      .sort((a, b) => b.impressions - a.impressions)
      .map(r => {
        const shortUrl = r.key.replace('https://healthdesk.site', '');
        const posClass = r.position <= 10 ? 'tk-pos-good' : r.position <= 30 ? 'tk-pos-mid' : 'tk-pos-low';
        return `<tr>
          <td class="tk-target" title="${escHtml(r.key)}">${escHtml(shortUrl)}</td>
          <td>${r.clicks}</td>
          <td>${r.impressions}</td>
          <td>${r.ctr}%</td>
          <td class="${posClass}">${r.position}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="text-center">Brak danych</td></tr>';

  } catch (e) {
    msgEl.innerHTML = `<span class="gsc-error">Błąd: ${escHtml(e.message)}</span>`;
  }
}

async function loadGscDiscover() {
  const tbody = document.getElementById('gsc-discover-tbody');
  tbody.innerHTML = '<tr><td colspan="6">Szukam nieśledzonych keywords...</td></tr>';

  try {
    const res = await fetch('/api/gsc/discover-keywords');
    const data = await res.json();

    if (data.error) {
      tbody.innerHTML = `<tr><td colspan="6" class="gsc-error">${escHtml(data.error)}</td></tr>`;
      return;
    }

    if (!data.discovered.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">Brak nowych keywords (wszystkie już śledzone lub brak danych GSC)</td></tr>';
      return;
    }

    tbody.innerHTML = data.discovered.map(r => {
      const shortPage = r.page.replace('https://healthdesk.site', '');
      const posClass = r.position <= 10 ? 'tk-pos-good' : r.position <= 30 ? 'tk-pos-mid' : 'tk-pos-low';
      return `<tr>
        <td class="tk-keyword">${escHtml(r.query)}</td>
        <td class="tk-target" title="${escHtml(r.page)}">${escHtml(shortPage)}</td>
        <td>${r.clicks}</td>
        <td>${r.impressions}</td>
        <td class="${posClass}">${r.position}</td>
        <td><button class="btn btn-xs btn-primary" onclick="trackFromGsc('${escHtml(r.query)}', '${escHtml(r.page)}')">+Track</button></td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="gsc-error">Błąd: ${escHtml(e.message)}</td></tr>`;
  }
}

async function trackFromGsc(keyword, pageUrl) {
  // Detect lang from page URL or keyword
  let lang = 'pl';
  if (pageUrl && pageUrl.includes('/en/')) lang = 'en';
  else if (pageUrl && pageUrl.includes('/de/')) lang = 'de';
  else if (/^[a-zA-Z\s]+$/.test(keyword)) lang = 'en';

  const targetUrl = pageUrl || '';
  let targetPage = '';
  if (pageUrl) {
    const path = pageUrl.replace('https://healthdesk.site/', '');
    targetPage = path.replace(/\/$/, '');
  }

  try {
    const res = await fetch('/api/keywords/tracked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, lang, targetUrl, targetPage })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Dodano "${keyword}" do Rank Trackera`, 'success');
      // Refresh discover view
      if (gscCurrentView === 'discover') loadGscDiscover();
    } else {
      showToast(data.error || 'Błąd', 'error');
    }
  } catch (e) {
    showToast('Błąd: ' + e.message, 'error');
  }
}

async function loadSiteStructure() {
  try {
    const res = await fetch('/api/site-structure');
    const pages = await res.json();
    const landings = pages.filter(p => p.type === 'landing');
    const blogs = pages.filter(p => p.type === 'blog');

    // Landing pages grid
    const landingsEl = document.getElementById('structure-landings');
    landingsEl.innerHTML = landings.map(p => {
      const posHtml = p.position ? `<span class="str-pos">#${p.position}</span>` : '';
      const kwHtml = p.keyword ? `<span class="str-kw">${escHtml(p.keyword)}</span>` : '<span class="str-no-kw">brak keyword</span>';
      return `<div class="str-card">
        <div class="str-card-head">
          <span class="str-lang">${p.lang.toUpperCase()}</span>
          ${posHtml}
        </div>
        <div class="str-card-url">${p.url.replace('https://healthdesk.site', '')}</div>
        <div class="str-card-kw">${kwHtml}</div>
        ${p.allKeywords.length > 1 ? `<div class="str-card-extra">+${p.allKeywords.length - 1} more keywords</div>` : ''}
      </div>`;
    }).join('');

    // Blog posts grid — grouped by language
    const blogsEl = document.getElementById('structure-blogs');
    const blogLangs = [...new Set(blogs.map(b => b.lang))].sort();
    blogsEl.innerHTML = blogLangs.map(lang => {
      const langBlogs = blogs.filter(b => b.lang === lang).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return `<div class="str-lang-group">
        <h4>${lang.toUpperCase()} (${langBlogs.length})</h4>
        ${langBlogs.map(p => {
          const posHtml = p.position ? `<span class="str-pos">#${p.position}</span>` : '';
          const kwHtml = p.keyword ? `<span class="str-kw">${escHtml(p.keyword)}</span>` : '<span class="str-no-kw">brak focus keyword!</span>';
          const sibHtml = p.siblings && Object.keys(p.siblings).length
            ? `<span class="str-sib">${Object.keys(p.siblings).map(l => l.toUpperCase()).join(', ')}</span>`
            : '<span class="str-no-sib">brak tłumaczeń</span>';
          const statusCls = p.status === 'published' ? 'str-published' : 'str-draft';
          return `<div class="str-card str-blog-card">
            <div class="str-card-head">
              <span class="str-status ${statusCls}">${p.status}</span>
              ${posHtml}
            </div>
            <div class="str-card-title">${escHtml(p.title)}</div>
            <div class="str-card-url">${p.url.replace('https://healthdesk.site', '')}</div>
            <div class="str-card-meta">
              <span class="str-card-kw">${kwHtml}</span>
              <span class="str-card-date">${p.date || ''}</span>
            </div>
            <div class="str-card-foot">Tłumaczenia: ${sibHtml}</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  } catch (e) {
    console.error('loadSiteStructure error:', e);
  }
}

async function checkAllPositions() {
  const btn = document.getElementById('btn-check-positions');
  btn.disabled = true;
  btn.textContent = 'Sprawdzanie...';

  try {
    const res = await fetch('/api/keywords/check-positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await res.json();
    showToast(`Sprawdzono ${data.checked} keywords`);
    loadTrackedKeywords();
  } catch (err) {
    showToast('Błąd: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sprawdź pozycje';
  }
}

async function checkCannibalization() {
  try {
    const res = await fetch('/api/keywords/cannibalization');
    const data = await res.json();
    const alertEl = document.getElementById('tracker-cannibalization');

    if (data.issues.length === 0) {
      alertEl.classList.add('hidden');
      return;
    }

    alertEl.classList.remove('hidden');
    alertEl.innerHTML = '<strong>⚠️ Kanibalizacja wykryta:</strong><br>' +
      data.issues.map(i =>
        `• <strong>${escHtml(i.keyword)}</strong>: target ${i.targetUrl || '?'}, ale rankuje ${i.foundUrl || '?'}` +
        (i.allMatches?.length > 1 ? ` (${i.allMatches.length} stron w wynikach!)` : '') +
        `<br><em>${i.suggestion}</em>`
      ).join('<br>');
  } catch {}
}

// ─── Autopilot ───
let apTopics = [];
let apPollInterval = null;

function apAddTopic() {
  const input = document.getElementById('ap-topic');
  const topic = input.value.trim();
  if (!topic) return;
  if (apTopics.includes(topic)) { showToast('Topic already added'); return; }
  apTopics.push(topic);
  input.value = '';
  apRenderTopics();
}

function apRemoveTopic(idx) {
  apTopics.splice(idx, 1);
  apRenderTopics();
}

function apRenderTopics() {
  const el = document.getElementById('ap-topics');
  if (apTopics.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = apTopics.map((t, i) =>
    `<div class="ap-topic-chip">
      <span>${escHtml(t)}</span>
      <button class="btn-close" onclick="apRemoveTopic(${i})">&times;</button>
    </div>`
  ).join('');
}

const AP_STEP_NAMES = [
  'Keyword Research', 'Keyword Analysis', 'AI Outline', 'Create Article',
  'AI Draft', 'AI Audit', 'Humanize', 'Grammar Fix',
  'AI Description', 'Hero Image', 'Save Article'
];

function apRenderProgress(data) {
  const el = document.getElementById('ap-progress');
  if (!data || data.status === 'idle') {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  const steps = data.steps || [];
  const stepsHtml = AP_STEP_NAMES.map((name, i) => {
    const step = steps[i];
    const status = step ? step.status : 'pending';
    const icon = status === 'done' ? '&#10003;' : status === 'running' ? '&#9679;' : status === 'error' ? '&#10007;' : status === 'skipped' ? '&#8212;' : '&#9675;';
    return `<div class="ap-step ${status}">${icon} ${name}</div>`;
  }).join('');

  const topicCounter = data.totalTopics > 1
    ? `<span class="ap-progress-counter">Topic ${(data.completedTopics || 0) + 1} / ${data.totalTopics}</span>`
    : '';

  el.innerHTML = `
    <div class="ap-progress-header">
      <span class="ap-progress-topic">${escHtml(data.currentTopic || '')}</span>
      ${topicCounter}
    </div>
    <div class="ap-steps">${stepsHtml}</div>
  `;
}

function apRenderResults(results) {
  const el = document.getElementById('ap-results');
  if (!results || results.length === 0) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  el.innerHTML = '<h3>Results</h3>' + results.map(r => {
    if (r.error) {
      return `<div class="ap-result-error">
        <strong>${escHtml(r.topic || '?')}</strong>: ${escHtml(r.error)}
      </div>`;
    }
    const scoreClass = r.score <= 3 ? 'ap-score-good' : r.score <= 6 ? 'ap-score-mid' : 'ap-score-bad';
    return `<div class="ap-result-card">
      <div class="ap-result-info">
        <div class="ap-result-title">${escHtml(r.title)}</div>
        <div class="ap-result-meta">
          <span>${r.lang.toUpperCase()}</span>
          <span>${r.wordCount} words</span>
          <span class="ap-result-score ${scoreClass}">AI: ${r.score}/10</span>
          ${r.heroImage ? '<span>Hero &#10003;</span>' : '<span style="color:var(--yellow)">No hero</span>'}
        </div>
      </div>
      <div class="ap-result-actions">
        <button class="btn btn-sm btn-primary" onclick="openArticle('${r.lang}','${escAttr(r.slug)}')">Open</button>
        <button class="btn btn-sm" onclick="window.open('/preview/${r.lang}/blog/${escAttr(r.slug)}/','_blank')">Preview</button>
      </div>
    </div>`;
  }).join('');
}

function apStartPolling() {
  apStopPolling();
  apPollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/ai/autopilot/status');
      const data = await res.json();
      apRenderProgress(data);
      if (data.results && data.results.length > 0) apRenderResults(data.results);
      if (data.status === 'done' || data.status === 'error' || data.status === 'idle') {
        apStopPolling();
        document.getElementById('btn-ap-start').disabled = false;
        document.getElementById('btn-ap-start').textContent = 'Generate All';
        if (data.status === 'done') showToast('Autopilot done!');
      }
    } catch {}
  }, 2000);
}

function apStopPolling() {
  if (apPollInterval) { clearInterval(apPollInterval); apPollInterval = null; }
}

async function apStart() {
  const lang = document.getElementById('ap-lang').value;
  const persona = document.getElementById('ap-persona').value.trim() || undefined;

  // If no chips, use the input field as single topic
  if (apTopics.length === 0) {
    const singleTopic = document.getElementById('ap-topic').value.trim();
    if (!singleTopic) { alert('Add at least one topic'); return; }
    apTopics.push(singleTopic);
    document.getElementById('ap-topic').value = '';
    apRenderTopics();
  }

  const btn = document.getElementById('btn-ap-start');
  btn.disabled = true;
  btn.textContent = 'Running...';
  document.getElementById('ap-results').classList.add('hidden');

  apStartPolling();

  try {
    if (apTopics.length === 1) {
      const res = await fetch('/api/ai/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang, topic: apTopics[0], persona })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      apRenderResults([data]);
    } else {
      const res = await fetch('/api/ai/autopilot/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang, topics: apTopics, persona })
      });
      const data = await res.json();
      apRenderResults(data.results || []);
    }
    apTopics = [];
    apRenderTopics();
  } catch (err) {
    showToast('Error: ' + err.message);
  }

  apStopPolling();
  btn.disabled = false;
  btn.textContent = 'Generate All';

  // Final status render
  try {
    const res = await fetch('/api/ai/autopilot/status');
    const data = await res.json();
    apRenderProgress(data);
  } catch {}
}
