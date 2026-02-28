#!/usr/bin/env node
/**
 * HealthDesk Blog Studio — Local server
 * Express backend for blog content management pipeline.
 * Run: npm start (from landing/studio/)
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const fm = require('front-matter');
const { marked } = require('marked');

const app = express();
const PORT = 4000;

// Paths
const LANDING_ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(LANDING_ROOT, 'src', 'content', 'blog');
const I18N_DIR = path.join(LANDING_ROOT, 'src', 'i18n');
const STUDIO_DATA = path.join(__dirname, 'studio.json');
const DIST_DIR = path.join(LANDING_ROOT, 'dist');

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Studio data (statuses, notes) ───
function loadStudioData() {
  if (fs.existsSync(STUDIO_DATA)) {
    return JSON.parse(fs.readFileSync(STUDIO_DATA, 'utf8'));
  }
  return { articles: {}, ideas: [] };
}

function saveStudioData(data) {
  fs.writeFileSync(STUDIO_DATA, JSON.stringify(data, null, 2), 'utf8');
}

// ─── API: List all articles ───
app.get('/api/articles', (req, res) => {
  const studio = loadStudioData();
  const articles = [];

  // Scan blog directories
  const langs = fs.readdirSync(BLOG_DIR).filter(f =>
    fs.statSync(path.join(BLOG_DIR, f)).isDirectory()
  );

  for (const lang of langs) {
    const langDir = path.join(BLOG_DIR, lang);
    const files = fs.readdirSync(langDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(langDir, file), 'utf8');
      const parsed = fm(content);
      const slug = parsed.attributes.slug || file.replace('.md', '');
      const key = `${lang}/${slug}`;

      const rawDate = parsed.attributes.date;
      const dateStr = rawDate instanceof Date ? rawDate.toISOString().split('T')[0] : String(rawDate || '');

      articles.push({
        key,
        lang,
        file,
        slug,
        title: parsed.attributes.title || slug,
        date: dateStr,
        description: parsed.attributes.description || '',
        tags: parsed.attributes.tags || [],
        siblings: parsed.attributes.siblings || {},
        status: (studio.articles[key] && studio.articles[key].status) || 'draft',
        wordCount: parsed.body.split(/\s+/).filter(Boolean).length
      });
    }
  }

  // Sort by date desc
  articles.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  res.json({ articles, langs });
});

// ─── API: Get single article ───
app.get('/api/articles/:lang/:slug', (req, res) => {
  const { lang, slug } = req.params;
  const filePath = findArticleFile(lang, slug);
  if (!filePath) return res.status(404).json({ error: 'Article not found' });

  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = fm(content);
  const html = marked(parsed.body);
  const studio = loadStudioData();
  const key = `${lang}/${slug}`;

  res.json({
    key,
    lang,
    slug,
    frontmatter: parsed.attributes,
    markdown: parsed.body,
    html,
    raw: content,
    status: (studio.articles[key] && studio.articles[key].status) || 'draft',
    seo: analyzeSEO(parsed.attributes, parsed.body, lang)
  });
});

// ─── API: Save article ───
app.put('/api/articles/:lang/:slug', (req, res) => {
  const { lang, slug } = req.params;
  const { frontmatter, markdown } = req.body;

  // Build frontmatter YAML
  let yamlLines = ['---'];
  yamlLines.push(`title: "${(frontmatter.title || '').replace(/"/g, '\\"')}"`);
  yamlLines.push(`slug: "${frontmatter.slug || slug}"`);
  yamlLines.push(`date: ${frontmatter.date || new Date().toISOString().split('T')[0]}`);
  yamlLines.push(`description: "${(frontmatter.description || '').replace(/"/g, '\\"')}"`);
  if (frontmatter.tags && frontmatter.tags.length) {
    yamlLines.push(`tags: [${frontmatter.tags.map(t => `"${t}"`).join(', ')}]`);
  }
  yamlLines.push(`lang: ${lang}`);
  if (frontmatter.siblings && Object.keys(frontmatter.siblings).length) {
    yamlLines.push('siblings:');
    for (const [l, s] of Object.entries(frontmatter.siblings)) {
      yamlLines.push(`  ${l}: "${s}"`);
    }
  }
  yamlLines.push('---');

  const fileContent = yamlLines.join('\n') + '\n' + markdown;

  // Ensure directory
  const langDir = path.join(BLOG_DIR, lang);
  fs.mkdirSync(langDir, { recursive: true });

  const actualSlug = frontmatter.slug || slug;
  const filePath = path.join(langDir, `${actualSlug}.md`);
  fs.writeFileSync(filePath, fileContent, 'utf8');

  res.json({ ok: true, path: filePath });
});

// ─── API: Create new article ───
app.post('/api/articles', (req, res) => {
  const { lang, slug, title } = req.body;
  if (!lang || !slug) return res.status(400).json({ error: 'lang and slug required' });

  const langDir = path.join(BLOG_DIR, lang);
  fs.mkdirSync(langDir, { recursive: true });

  const filePath = path.join(langDir, `${slug}.md`);
  if (fs.existsSync(filePath)) {
    return res.status(409).json({ error: 'Article already exists' });
  }

  const content = `---
title: "${title || slug}"
slug: "${slug}"
date: ${new Date().toISOString().split('T')[0]}
description: ""
tags: []
lang: ${lang}
---

##
`;

  fs.writeFileSync(filePath, content, 'utf8');

  // Set status
  const studio = loadStudioData();
  studio.articles[`${lang}/${slug}`] = { status: 'idea' };
  saveStudioData(studio);

  res.json({ ok: true, key: `${lang}/${slug}` });
});

// ─── API: Delete article ───
app.delete('/api/articles/:lang/:slug', (req, res) => {
  const { lang, slug } = req.params;
  const filePath = findArticleFile(lang, slug);
  if (!filePath) return res.status(404).json({ error: 'Not found' });

  fs.unlinkSync(filePath);

  const studio = loadStudioData();
  delete studio.articles[`${lang}/${slug}`];
  saveStudioData(studio);

  res.json({ ok: true });
});

// ─── API: Update article status ───
app.patch('/api/articles/:lang/:slug/status', (req, res) => {
  const { lang, slug } = req.params;
  const { status } = req.body;
  const key = `${lang}/${slug}`;

  const studio = loadStudioData();
  if (!studio.articles[key]) studio.articles[key] = {};
  studio.articles[key].status = status;
  saveStudioData(studio);

  res.json({ ok: true });
});

// ─── API: SEO analysis ───
app.post('/api/seo/analyze', (req, res) => {
  const { frontmatter, markdown, lang } = req.body;
  const result = analyzeSEO(frontmatter, markdown, lang);
  res.json(result);
});

// ─── API: Grammar check (LanguageTool) ───
app.post('/api/check/grammar', async (req, res) => {
  const { text, lang } = req.body;
  const ltLang = lang === 'pl' ? 'pl-PL' : lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es' : lang;

  try {
    const response = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text, language: ltLang, enabledOnly: 'false' })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Readability analysis ───
app.post('/api/check/readability', (req, res) => {
  const { text, lang } = req.body;
  res.json(analyzeReadability(text, lang));
});

// ─── API: Build ───
app.post('/api/build', (req, res) => {
  try {
    const output = execSync('node build.js', { cwd: LANDING_ROOT, encoding: 'utf8', timeout: 30000 });
    res.json({ ok: true, output });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

// ─── API: Preview (check if dist exists) ───
app.get('/api/preview/status', (req, res) => {
  const exists = fs.existsSync(DIST_DIR);
  const pages = exists ? countFiles(DIST_DIR, '.html') : 0;
  res.json({ exists, pages });
});

// Serve dist for preview
app.use('/preview', express.static(DIST_DIR));

// ─── API: Deploy ───
app.post('/api/deploy', (req, res) => {
  exec('node deploy.js', { cwd: LANDING_ROOT, timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      res.status(500).json({ error: stderr || err.message });
    } else {
      res.json({ ok: true, output: stdout });
    }
  });
});

// ─── API: Ideas ───
app.get('/api/ideas', (req, res) => {
  const studio = loadStudioData();
  res.json(studio.ideas || []);
});

app.post('/api/ideas', (req, res) => {
  const { keyword, lang, notes, serpScore } = req.body;
  const studio = loadStudioData();
  if (!studio.ideas) studio.ideas = [];
  const idea = {
    id: Date.now().toString(36),
    keyword,
    lang: lang || 'pl',
    notes: notes || '',
    serpScore: serpScore || null,
    createdAt: new Date().toISOString(),
    status: 'idea'
  };
  studio.ideas.push(idea);
  saveStudioData(studio);
  res.json(idea);
});

app.delete('/api/ideas/:id', (req, res) => {
  const studio = loadStudioData();
  studio.ideas = (studio.ideas || []).filter(i => i.id !== req.params.id);
  saveStudioData(studio);
  res.json({ ok: true });
});

// ─── Helpers ───
function findArticleFile(lang, slug) {
  const dir = path.join(BLOG_DIR, lang);
  if (!fs.existsSync(dir)) return null;

  // Try exact slug match
  const exact = path.join(dir, `${slug}.md`);
  if (fs.existsSync(exact)) return exact;

  // Scan files for matching slug in frontmatter
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    const parsed = fm(content);
    if (parsed.attributes.slug === slug) return path.join(dir, file);
  }
  return null;
}

function countFiles(dir, ext) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name), ext);
    else if (entry.name.endsWith(ext)) count++;
  }
  return count;
}

// ─── SEO Analyzer ───
function analyzeSEO(frontmatter, markdown, lang) {
  const checks = [];
  const title = frontmatter.title || '';
  const desc = frontmatter.description || '';
  const body = markdown || '';
  const words = body.split(/\s+/).filter(Boolean);
  const headings = body.match(/^##\s+.+$/gm) || [];
  const h3s = body.match(/^###\s+.+$/gm) || [];
  const links = body.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
  const internalLinks = links.filter(l => l.includes('healthdesk'));

  // Title
  const titleLen = title.length;
  checks.push({
    id: 'title-length',
    label: 'Title length (50-60 chars)',
    value: titleLen,
    pass: titleLen >= 40 && titleLen <= 65,
    hint: titleLen < 40 ? 'Too short — add more descriptive words' : titleLen > 65 ? 'Too long — trim to ~60 chars' : 'Good'
  });

  // Meta description
  const descLen = desc.length;
  checks.push({
    id: 'desc-length',
    label: 'Meta description (120-160 chars)',
    value: descLen,
    pass: descLen >= 100 && descLen <= 165,
    hint: descLen < 100 ? 'Too short — expand the summary' : descLen > 165 ? 'Too long — will be truncated in SERP' : 'Good'
  });

  // Word count
  checks.push({
    id: 'word-count',
    label: 'Word count (800+ recommended)',
    value: words.length,
    pass: words.length >= 800,
    hint: words.length < 500 ? 'Very thin content' : words.length < 800 ? 'Consider expanding' : 'Good length'
  });

  // H2 headings
  checks.push({
    id: 'h2-count',
    label: 'H2 headings (3+ recommended)',
    value: headings.length,
    pass: headings.length >= 3,
    hint: headings.length < 2 ? 'Add more section headings' : 'Good structure'
  });

  // H2 as questions
  const questionH2s = headings.filter(h => h.includes('?'));
  checks.push({
    id: 'h2-questions',
    label: 'H2s as questions (SEO + featured snippets)',
    value: questionH2s.length,
    pass: questionH2s.length >= 1,
    hint: questionH2s.length === 0 ? 'Rephrase at least one H2 as a question' : 'Good — helps with featured snippets'
  });

  // Answer block (40-60 words after first H2)
  const firstH2Idx = body.indexOf('\n## ');
  let answerBlockOk = false;
  if (firstH2Idx >= 0) {
    const afterH2 = body.slice(firstH2Idx).split('\n').slice(1);
    const firstPara = afterH2.find(l => l.trim() && !l.startsWith('#'));
    if (firstPara) {
      const paraWords = firstPara.split(/\s+/).filter(Boolean).length;
      answerBlockOk = paraWords >= 30 && paraWords <= 80;
    }
  }
  checks.push({
    id: 'answer-block',
    label: 'Answer block after H2 (40-60 words)',
    value: answerBlockOk ? 'Yes' : 'No',
    pass: answerBlockOk,
    hint: 'First paragraph after H2 should be a concise answer (40-60 words) for featured snippets'
  });

  // Internal links
  checks.push({
    id: 'internal-links',
    label: 'Internal links (2+ recommended)',
    value: internalLinks.length,
    pass: internalLinks.length >= 2,
    hint: 'Link to other articles or the main app page'
  });

  // Tags
  const tags = frontmatter.tags || [];
  checks.push({
    id: 'tags',
    label: 'Tags (2-5 recommended)',
    value: tags.length,
    pass: tags.length >= 2 && tags.length <= 5,
    hint: tags.length < 2 ? 'Add at least 2 tags' : 'Good'
  });

  // Siblings (translations)
  const siblings = frontmatter.siblings || {};
  checks.push({
    id: 'siblings',
    label: 'Translation siblings',
    value: Object.keys(siblings).length,
    pass: Object.keys(siblings).length >= 1,
    hint: 'Add at least an EN translation for wider reach'
  });

  // Date
  checks.push({
    id: 'date',
    label: 'Publication date set',
    value: frontmatter.date || 'missing',
    pass: !!frontmatter.date,
    hint: 'Set a date for the article'
  });

  const score = Math.round((checks.filter(c => c.pass).length / checks.length) * 100);
  return { score, checks };
}

// ─── Readability Analyzer ───
function analyzeReadability(text, lang) {
  // Strip markdown formatting
  const plain = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/`[^`]+`/g, '')
    .trim();

  // Split into sentences (basic)
  const sentences = plain.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const words = plain.split(/\s+/).filter(Boolean);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w, lang), 0);

  const avgSentenceLen = sentences.length ? words.length / sentences.length : 0;
  const avgSyllables = words.length ? syllables / words.length : 0;

  // Flesch Reading Ease (adapted)
  const flesch = 206.835 - (1.015 * avgSentenceLen) - (84.6 * avgSyllables);

  // Long sentences (>25 words)
  const longSentences = sentences.filter(s => s.split(/\s+/).length > 25);

  // Very long sentences (>40 words)
  const veryLongSentences = sentences.filter(s => s.split(/\s+/).length > 40);

  // Short paragraphs check
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim() && !p.trim().startsWith('#'));
  const longParagraphs = paragraphs.filter(p => p.split(/\s+/).length > 100);

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    avgSentenceLength: Math.round(avgSentenceLen * 10) / 10,
    fleschScore: Math.round(flesch),
    fleschLabel: flesch >= 60 ? 'Easy' : flesch >= 40 ? 'Medium' : 'Hard',
    longSentences: longSentences.length,
    veryLongSentences: veryLongSentences.length,
    longParagraphs: longParagraphs.length,
    issues: [
      ...(veryLongSentences.length ? [`${veryLongSentences.length} very long sentences (40+ words) — consider splitting`] : []),
      ...(longSentences.length > 3 ? [`${longSentences.length} long sentences (25+ words)`] : []),
      ...(longParagraphs.length ? [`${longParagraphs.length} paragraphs over 100 words — break them up`] : []),
      ...(flesch < 40 ? ['Text is hard to read — simplify vocabulary and shorten sentences'] : [])
    ]
  };
}

function countSyllables(word, lang) {
  // Simple heuristic — works reasonably for PL/EN
  word = word.toLowerCase().replace(/[^a-ząćęłńóśźżäöüßàâéèêëïîôùûüç]/g, '');
  if (word.length <= 3) return 1;
  // Count vowel groups
  const vowels = lang === 'pl' ? /[aeiouyąęó]+/gi : /[aeiouy]+/gi;
  const matches = word.match(vowels);
  return matches ? Math.max(1, matches.length) : 1;
}

// ─── Start ───
app.listen(PORT, () => {
  console.log(`\n  Blog Studio running at http://localhost:${PORT}\n`);
  console.log(`  Blog dir:  ${BLOG_DIR}`);
  console.log(`  Dist dir:  ${DIST_DIR}`);
  console.log(`  Studio DB: ${STUDIO_DATA}\n`);
});
