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
const sharp = require('sharp');

const app = express();
const PORT = 4000;

// ─── Claude API ───
function getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return key;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'studio.json'), 'utf8'));
    return data.anthropic_api_key || '';
  } catch { return ''; }
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 2000) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY configured');

  console.log(`[AI] Calling Claude (max_tokens=${maxTokens})...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // 180s timeout

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      console.error(`[AI] Error ${response.status}: ${err}`);
      throw new Error(`Claude API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    console.log(`[AI] Response received (${data.usage?.output_tokens || '?'} tokens)`);
    return data.content[0].text;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Claude API timeout (180s)');
    throw err;
  }
}

function parseJsonResponse(text) {
  // Strip markdown fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

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
// Serve dist assets at root level too (HTML uses absolute paths like /style.css)
app.use(express.static(DIST_DIR));

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

// ─── Serper API helper ───
function getSerperKey() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'studio.json'), 'utf8'));
    return data.serper_api_key || '';
  } catch { return ''; }
}

const LANG_MAP = {
  pl: { gl: 'pl', hl: 'pl' },
  en: { gl: 'us', hl: 'en' },
  de: { gl: 'de', hl: 'de' },
  es: { gl: 'es', hl: 'es' },
  fr: { gl: 'fr', hl: 'fr' }
};

async function serperRequest(endpoint, body) {
  const key = getSerperKey();
  if (!key) throw new Error('No serper_api_key configured in studio.json');

  const response = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Serper API error ${response.status}: ${err}`);
  }
  return response.json();
}

// ─── API: Keyword search (Serper) ───
app.post('/api/keywords/search', async (req, res) => {
  const { query, lang } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const locale = LANG_MAP[lang] || LANG_MAP.en;

  try {
    console.log(`[Keywords] Searching "${query}" (${lang})...`);

    const [searchData, autocompleteData] = await Promise.all([
      serperRequest('search', { q: query, gl: locale.gl, hl: locale.hl, num: 5 }),
      serperRequest('autocomplete', { q: query, gl: locale.gl, hl: locale.hl })
    ]);

    console.log('[Keywords] Raw search keys:', Object.keys(searchData));
    if (searchData.peopleAlsoAsk) console.log('[Keywords] PAA sample:', JSON.stringify(searchData.peopleAlsoAsk[0]));
    if (searchData.relatedSearches) console.log('[Keywords] Related sample:', JSON.stringify(searchData.relatedSearches[0]));
    console.log('[Keywords] Autocomplete keys:', Object.keys(autocompleteData));
    if (autocompleteData.suggestions) console.log('[Keywords] AC sample:', JSON.stringify(autocompleteData.suggestions[0]));

    const result = {
      organic: (searchData.organic || []).slice(0, 5).map(r => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet,
        position: r.position
      })),
      peopleAlsoAsk: (searchData.peopleAlsoAsk || []).map(p => p.question),
      relatedSearches: (searchData.relatedSearches || []).map(r => r.query),
      autocomplete: (autocompleteData.suggestions || []).slice(0, 8).map(s => typeof s === 'string' ? s : s.value || s.text || String(s))
    };

    console.log(`[Keywords] Found: ${result.organic.length} organic, ${result.peopleAlsoAsk.length} PAA, ${result.relatedSearches.length} related, ${result.autocomplete.length} autocomplete`);
    res.json(result);
  } catch (err) {
    console.error(`[Keywords] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Keyword AI analysis ───
app.post('/api/keywords/analyze', async (req, res) => {
  const { query, lang, serp } = req.body;
  if (!query || !serp) return res.status(400).json({ error: 'query and serp data required' });

  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';

  const serpSummary = (serp.organic || []).map((r, i) =>
    `${i+1}. "${r.title}" — ${r.link}\n   ${r.snippet}`
  ).join('\n');

  const paa = (serp.peopleAlsoAsk || []).map(q => `- ${q}`).join('\n');
  const related = (serp.relatedSearches || []).join(', ');
  const autocomplete = (serp.autocomplete || []).join(', ');

  try {
    const result = await callClaude(
      `You are an SEO analyst for HealthDesk, a desktop wellness app (break reminders, eye exercises, stretch exercises, water tracking, activity monitoring). Analyze keyword potential based on real SERP data.`,
      `Analyze this keyword for blog content potential.

Keyword: "${query}"
Language: ${langName}

SERP Top 5:
${serpSummary}

People Also Ask:
${paa}

Related Searches: ${related}
Autocomplete suggestions: ${autocomplete}

Evaluate:
1. **Potential** (1-5 stars): Is there search demand? Are people looking for this?
2. **Competition** (1-5 stars): How strong are the current top results? Medical sites? Big brands?
3. **Relevance** (1-5 stars): How well does this fit HealthDesk's blog (wellness, breaks, ergonomics, eyes, productivity)?
4. **Suggested title**: SEO-optimized title (50-60 chars, in ${langName})
5. **Suggested angle**: What unique perspective can HealthDesk offer vs existing results?
6. **Notes**: Any additional observations

Return as JSON:
{
  "potential": 4,
  "competition": 3,
  "relevance": 5,
  "suggestedTitle": "...",
  "suggestedAngle": "...",
  "notes": "..."
}
Return ONLY valid JSON.`,
      1000
    );
    res.json(parseJsonResponse(result));
  } catch (err) {
    console.error(`[Keywords Analyze] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── AI: Generate outline from keyword ───
app.post('/api/ai/outline', async (req, res) => {
  const { keyword, lang } = req.body;
  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';

  try {
    const result = await callClaude(
      `You are an SEO content strategist for HealthDesk, a desktop wellness app (break reminders, eye exercises, water tracking, activity monitoring). Generate blog article outlines optimized for search engines.`,
      `Generate a blog article outline for the keyword: "${keyword}"
Language: ${langName}
Requirements:
- Title (50-60 characters, include keyword)
- Meta description (120-160 characters)
- 5-7 H2 headings (at least 2 as questions for featured snippets)
- 2-3 H3 subheadings under each H2
- Suggested tags (3-5)
- Naturally mention HealthDesk where relevant

Return as JSON:
{
  "title": "...",
  "description": "...",
  "tags": ["..."],
  "outline": [
    { "h2": "...", "h3": ["...", "..."] }
  ]
}
Return ONLY valid JSON, no markdown fences.`
    );
    res.json(parseJsonResponse(result));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Draft: progress tracking ───
let draftProgress = null; // { slug, lang, title, chunk, totalChunks, sections, status, startedAt, words }

app.get('/api/ai/draft/status', (req, res) => {
  res.json(draftProgress || { status: 'idle' });
});

// ─── AI: Write full draft from outline (chunked by 2-3 sections) ───
app.post('/api/ai/draft', async (req, res) => {
  const { title, description, outline, lang, keyword, slug } = req.body;
  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';

  // Split outline into chunks of 2-3 sections
  const CHUNK_SIZE = 2;
  const chunks = [];
  for (let i = 0; i < outline.length; i += CHUNK_SIZE) {
    chunks.push(outline.slice(i, i + CHUNK_SIZE));
  }

  const fullOutlineText = outline.map(s => {
    let t = `## ${s.h2}`;
    if (s.h3) t += '\n' + s.h3.map(h => `### ${h}`).join('\n');
    return t;
  }).join('\n\n');

  const systemPrompt = `You are a health & productivity blog writer for HealthDesk (desktop wellness app). Write engaging, SEO-optimized articles in Markdown. Follow these rules:
- Write in ${langName}
- First paragraph after each H2 should be a concise answer (40-60 words) — optimized for featured snippets
- Use short paragraphs (2-3 sentences)
- Include relevant statistics with sources
- Naturally mention HealthDesk features where relevant (link format: [HealthDesk](https://healthdesk.site/${lang}/))
- Use **bold** for key terms
- Include at least 1 internal link to healthdesk.site per chunk
- Do NOT write a conclusion unless explicitly told to`;

  console.log(`[AI Draft] Generating in ${chunks.length} chunks (${outline.length} sections total)`);

  // Init progress
  draftProgress = {
    slug: slug || '',
    lang,
    title,
    chunk: 0,
    totalChunks: chunks.length,
    sections: '',
    status: 'generating',
    startedAt: Date.now(),
    words: 0
  };

  try {
    const parts = [];
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const isLast = ci === chunks.length - 1;

      const chunkOutline = chunk.map(s => {
        let t = `## ${s.h2}`;
        if (s.h3) t += '\n' + s.h3.map(h => `### ${h}`).join('\n');
        return t;
      }).join('\n\n');

      const prevContext = parts.length > 0
        ? `\n\nPrevious sections already written (for context, do NOT repeat):\n${parts.join('\n').slice(-600)}`
        : '';

      const conclusionNote = isLast
        ? '\n\nThis is the LAST chunk — end with a brief conclusion section (## header + 2-3 sentences).'
        : '\n\nDo NOT end with a conclusion — more sections follow.';

      // Update progress
      draftProgress.chunk = ci + 1;
      draftProgress.sections = chunk.map(s => s.h2).join(', ');

      console.log(`[AI Draft] Chunk ${ci + 1}/${chunks.length}: ${draftProgress.sections}`);

      const result = await callClaude(
        systemPrompt,
        `Write sections ${ci * CHUNK_SIZE + 1}-${ci * CHUNK_SIZE + chunk.length} of a blog article in Markdown.

Article title: ${title}
Keyword: ${keyword || title}
Description: ${description}

Full outline (for context):
${fullOutlineText}

NOW WRITE ONLY THESE SECTIONS:
${chunkOutline}
${prevContext}
${conclusionNote}

Write ~${isLast ? '150-250' : '200-350'} words per H2 section. Start directly with ## heading. No frontmatter.`,
        2000
      );

      parts.push(result.trim());
      draftProgress.words = parts.join('\n\n').split(/\s+/).length;
    }

    const markdown = parts.join('\n\n');
    console.log(`[AI Draft] Done: ${markdown.split(/\s+/).length} words total`);

    // Auto-save draft to disk so it's not lost if browser times out
    if (slug && lang) {
      try {
        const langDir = path.join(BLOG_DIR, lang);
        fs.mkdirSync(langDir, { recursive: true });
        const frontmatterYaml = [
          '---',
          `title: "${(title || '').replace(/"/g, '\\"')}"`,
          `slug: "${slug}"`,
          `date: ${new Date().toISOString().split('T')[0]}`,
          `description: "${(description || '').replace(/"/g, '\\"')}"`,
          `tags: []`,
          `lang: ${lang}`,
          '---'
        ].join('\n');
        fs.writeFileSync(path.join(langDir, `${slug}.md`), frontmatterYaml + '\n' + markdown, 'utf8');
        console.log(`[AI Draft] Auto-saved to ${lang}/${slug}.md`);
      } catch (saveErr) {
        console.error(`[AI Draft] Auto-save failed: ${saveErr.message}`);
      }
    }

    draftProgress.status = 'done';
    draftProgress.words = markdown.split(/\s+/).length;
    res.json({ markdown });

    // Clear progress after 30s
    setTimeout(() => { if (draftProgress && draftProgress.status === 'done') draftProgress = null; }, 30000);
  } catch (err) {
    draftProgress.status = 'error';
    draftProgress.error = err.message;
    res.status(500).json({ error: err.message });
    setTimeout(() => { draftProgress = null; }, 30000);
  }
});

// ─── AI: Suggest meta description ───
app.post('/api/ai/description', async (req, res) => {
  const { markdown, title, lang } = req.body;
  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';

  try {
    const result = await callClaude(
      'You are an SEO specialist. Generate meta descriptions that are compelling, include the main keyword, and drive clicks.',
      `Generate a meta description (120-160 characters) in ${langName} for this article:
Title: ${title}
Content preview: ${markdown.slice(0, 500)}

Return ONLY the description text, nothing else.`,
      200
    );
    res.json({ description: result.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI: Fix grammar & readability ───
app.post('/api/ai/fix-grammar', async (req, res) => {
  const { markdown, issues, lang } = req.body;
  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';

  // Build actionable issue list — only include issues with concrete suggestions
  const actionableIssues = (issues || []).filter(i => i.suggestion && i.suggestion.trim()).map((i, idx) =>
    `${idx+1}. Find: "${i.context.trim()}" → Replace with suggestion: "${i.suggestion}". Reason: ${i.message}`
  );
  const otherIssues = (issues || []).filter(i => !i.suggestion || !i.suggestion.trim()).map((i, idx) =>
    `${idx+1}. Issue near: "${i.context.trim()}" — ${i.message}`
  );

  const issueList = [...actionableIssues, ...otherIssues].join('\n');
  console.log(`[AI Fix Grammar] ${issues?.length || 0} issues (${actionableIssues.length} actionable), markdown: ${markdown?.length || 0} chars`);
  console.log(`[AI Fix Grammar] Issues:\n${issueList.slice(0, 800)}`);

  try {
    const result = await callClaude(
      `You are a professional ${langName} text editor. You MUST fix the listed grammar/spelling issues in a Markdown article.

CRITICAL RULES:
- You MUST make changes. If you return the same text, you have failed.
- Apply EVERY suggested replacement listed below.
- Fix spelling errors even in proper nouns if a suggestion is given.
- Add missing commas between clauses.
- Add missing periods after abbreviations (Pon. Wt. Śr. Czw. Pt.).
- Shorten sentences over 25 words by splitting into two sentences.
- Break paragraphs longer than 3 sentences.
- Preserve Markdown: ##, ###, **bold**, [links](url), lists, tables.
- Do NOT remove or add content. Only fix grammar/spelling/punctuation.
- Brand name "HealthDesk" stays capitalized (ignore any suggestion to lowercase it).`,
      `Apply these fixes to the ${langName} article below:

FIXES TO APPLY:
${issueList}

ARTICLE TO FIX:
${markdown}

Return the FIXED article. No markdown fences, no comments. Start with ## heading.`,
      8000
    );
    // Strip markdown fences if AI wraps the response
    let cleaned = result.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:markdown)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const changed = cleaned.trim() !== markdown.trim();
    console.log(`[AI Fix Grammar] Result: ${cleaned.length} chars, changed: ${changed}`);
    if (!changed) console.log(`[AI Fix Grammar] WARNING: AI returned identical text!`);
    res.json({ markdown: cleaned });
  } catch (err) {
    console.error(`[AI Fix Grammar] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── AI: Expand a section ───
app.post('/api/ai/expand', async (req, res) => {
  const { heading, context, lang } = req.body;
  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';

  try {
    const result = await callClaude(
      `You are a health & productivity blog writer. Write informative, engaging content in ${langName}. Use short paragraphs, bold key terms, include data where possible.`,
      `Expand this section heading into 150-250 words of content:
Heading: ${heading}
Article context: ${context.slice(0, 300)}

Write in Markdown. Start with an answer block (40-60 words concise answer), then expand with details. Include a relevant statistic if possible.`,
      800
    );
    res.json({ markdown: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI: Improve SEO ───
app.post('/api/ai/improve-seo', async (req, res) => {
  const { markdown, frontmatter, seoChecks, lang } = req.body;
  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';

  const failedChecks = (seoChecks || []).filter(c => !c.pass).map(c => `- ${c.label}: ${c.hint}`).join('\n');

  try {
    const result = await callClaude(
      `You are an SEO optimizer for blog articles. Suggest specific, actionable improvements. Write in ${langName}.`,
      `This article has SEO issues. Suggest fixes.

Title: ${frontmatter.title}
Description: ${frontmatter.description}
Failed checks:
${failedChecks}

Current article (first 800 chars):
${markdown.slice(0, 800)}

For each failed check, provide a specific suggestion. If title/description needs changing, provide the new text. If content is too short, suggest which sections to expand. Return as JSON:
{
  "suggestions": [
    { "check": "...", "action": "...", "newText": "..." }
  ]
}
Return ONLY valid JSON.`,
      1500
    );
    res.json(parseJsonResponse(result));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI: Create localized version of article ───
app.post('/api/ai/create-version', async (req, res) => {
  const { sourceLang, targetLang, slug, frontmatter, markdown } = req.body;
  const langNames = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', sv: 'Swedish', ja: 'Japanese', ko: 'Korean', zh: 'Chinese' };
  const targetName = langNames[targetLang] || 'English';
  const sourceName = langNames[sourceLang] || 'Polish';

  const targetDir = path.join(BLOG_DIR, targetLang);

  try {
    // Step 1: Generate SEO-optimized title, slug + description for target language
    const metaResult = await callClaude(
      `You are an SEO content strategist. You create search-optimized metadata for blog articles targeting ${targetName}-speaking Google users.`,
      `I have a ${sourceName} blog article. I need you to create an SEO-optimized title, URL slug, and meta description for the ${targetName} version.

DO NOT translate literally. Instead:
- Research what ${targetName}-speaking users would search for on this topic
- Create a title that targets high-volume ${targetName} keywords (50-60 chars)
- Create a URL slug in ${targetName}: lowercase, hyphens, no special chars, 3-6 words max (e.g. "pomodoro-technique-complete-guide")
- Create a meta description that drives clicks (140-155 chars)
- Generate 3-5 relevant tags in ${targetName}

Source title: ${frontmatter.title}
Source slug: ${slug}
Source description: ${frontmatter.description}
Source tags: ${(frontmatter.tags || []).join(', ')}

Topic summary (first 500 chars of article):
${markdown.slice(0, 500)}

Return ONLY valid JSON:
{
  "title": "...",
  "slug": "...",
  "description": "...",
  "tags": ["...", "..."]
}`,
      800
    );
    const meta = parseJsonResponse(metaResult);
    const targetSlug = (meta.slug || slug).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');

    // Check if target already exists
    const targetPath = path.join(targetDir, `${targetSlug}.md`);
    if (fs.existsSync(targetPath)) {
      return res.status(409).json({ error: `Article already exists: ${targetLang}/${targetSlug}` });
    }

    // Step 2: Generate full article content
    const contentResult = await callClaude(
      `You are a professional ${targetName} content writer specializing in health, wellness, and productivity topics. You write native-quality ${targetName} articles optimized for Google search.

CRITICAL RULES:
- Do NOT translate the source article. Write a fresh ${targetName} article on the same topic.
- Use the source article as a reference for structure and key points, but adapt for ${targetName} audience.
- Use natural ${targetName} idioms, phrasing, and examples.
- Optimize headings (H2/H3) for ${targetName} search keywords.
- Include relevant internal context for ${targetName}-speaking readers.
- Target similar word count as the source (~${markdown.split(/\s+/).length} words).
- Output pure Markdown (no frontmatter, no code fences around the whole article).`,
      `Write a comprehensive ${targetName} blog article based on this ${sourceName} source:

Title for ${targetName} version: ${meta.title}

Source article structure and content:
${markdown.slice(0, 6000)}

Write the full article in ${targetName}. Use proper Markdown with ## and ### headings. Make it feel native, not translated.`,
      4000
    );

    // Step 3: Save the article
    fs.mkdirSync(targetDir, { recursive: true });

    const yamlLines = ['---'];
    yamlLines.push(`title: "${(meta.title || '').replace(/"/g, '\\"')}"`);
    yamlLines.push(`slug: "${targetSlug}"`);
    yamlLines.push(`date: ${new Date().toISOString().split('T')[0]}`);
    yamlLines.push(`description: "${(meta.description || '').replace(/"/g, '\\"')}"`);
    if (meta.tags && meta.tags.length) {
      yamlLines.push(`tags: [${meta.tags.map(t => `"${t}"`).join(', ')}]`);
    }
    yamlLines.push(`lang: ${targetLang}`);
    yamlLines.push('siblings:');
    yamlLines.push(`  ${sourceLang}: "${slug}"`);
    yamlLines.push('---');

    const fileContent = yamlLines.join('\n') + '\n' + contentResult;
    fs.writeFileSync(targetPath, fileContent, 'utf8');

    // Step 4: Update source article with sibling reference
    const sourceFile = findArticleFile(sourceLang, slug);
    if (sourceFile) {
      let sourceContent = fs.readFileSync(sourceFile, 'utf8');
      if (!sourceContent.includes(`siblings:`) || !sourceContent.includes(`${targetLang}:`)) {
        // Add sibling to source frontmatter
        if (sourceContent.includes('siblings:')) {
          sourceContent = sourceContent.replace(/siblings:\n/, `siblings:\n  ${targetLang}: "${targetSlug}"\n`);
        } else {
          // Insert siblings before the closing --- of frontmatter
          const fmEnd = sourceContent.indexOf('---', 4);
          if (fmEnd > 0) {
            sourceContent = sourceContent.slice(0, fmEnd) + `siblings:\n  ${targetLang}: "${targetSlug}"\n` + sourceContent.slice(fmEnd);
          }
        }
        fs.writeFileSync(sourceFile, sourceContent, 'utf8');
      }
    }

    res.json({
      ok: true,
      path: targetPath,
      slug: targetSlug,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      wordCount: contentResult.split(/\s+/).length
    });
  } catch (err) {
    console.error('[AI create-version]', err);
    res.status(500).json({ error: err.message });
  }
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

// ─── AI: Generate hero image (Replicate Flux → WebP) ───
const BLOG_IMAGES_DIR = path.join(LANDING_ROOT, 'src', 'content', 'images', 'blog');

function getReplicateKey() {
  const studio = JSON.parse(fs.readFileSync(STUDIO_DATA, 'utf8'));
  return studio.replicate_api_key || process.env.REPLICATE_API_TOKEN || null;
}

app.post('/api/ai/generate-image', async (req, res) => {
  const { slug, lang, title, description, style } = req.body;
  const apiKey = getReplicateKey();
  if (!apiKey) return res.status(400).json({ error: 'No Replicate API key configured. Add replicate_api_key to studio.json' });

  try {
    // Step 1: Claude generates an optimal image prompt
    const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';
    const promptResult = await callClaude(
      `You generate image prompts for the Flux AI model. Output ONLY the prompt text, nothing else.`,
      `Generate a photorealistic image prompt for a blog hero image (1200x630px, landscape).

Article title: ${title}
Article description: ${description}
Style preference: ${style || 'clean, modern, professional'}

Requirements:
- Photorealistic or high-quality illustration style
- Related to workplace health, wellness, productivity, or ergonomics
- No text or typography in the image
- Good contrast, visually striking for a blog header
- Suitable as og:image for social media sharing
- DO NOT include any people's faces (to avoid AI face artifacts)

Output ONLY the image generation prompt, max 200 words.`,
      300
    );

    const imagePrompt = promptResult.trim();
    console.log(`[Image] Prompt: ${imagePrompt.slice(0, 100)}...`);

    // Step 2: Call Replicate API (Flux Schnell — fast, cheap)
    console.log('[Image] Calling Replicate Flux...');
    const replicateRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'black-forest-labs/flux-schnell',
        input: {
          prompt: imagePrompt,
          aspect_ratio: '16:9',
          output_format: 'webp',
          output_quality: 80,
          num_outputs: 1
        }
      })
    });

    if (!replicateRes.ok) {
      const err = await replicateRes.json();
      throw new Error(err.detail || `Replicate API error: ${replicateRes.status}`);
    }

    let prediction = await replicateRes.json();

    // Step 3: Poll for completion
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      await new Promise(r => setTimeout(r, 1500));
      const pollRes = await fetch(prediction.urls.get, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      prediction = await pollRes.json();
      console.log(`[Image] Status: ${prediction.status}`);
    }

    if (prediction.status === 'failed') {
      throw new Error(prediction.error || 'Image generation failed');
    }

    const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    console.log(`[Image] Generated: ${imageUrl}`);

    // Step 4: Download and optimize with sharp
    const imgResponse = await fetch(imageUrl);
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

    // Optimize: resize to 1200x630 (og:image standard), WebP quality 82
    fs.mkdirSync(BLOG_IMAGES_DIR, { recursive: true });
    const filename = `${slug}.webp`;
    const filepath = path.join(BLOG_IMAGES_DIR, filename);

    await sharp(imgBuffer)
      .resize(1200, 630, { fit: 'cover' })
      .webp({ quality: 82 })
      .toFile(filepath);

    const stats = fs.statSync(filepath);
    console.log(`[Image] Saved: ${filepath} (${(stats.size / 1024).toFixed(1)} KB)`);

    // Step 5: Generate SEO alt text
    const altResult = await callClaude(
      `Generate a concise, descriptive alt text for an image. Output ONLY the alt text, max 125 characters.`,
      `Blog article: "${title}"\nImage prompt used: "${imagePrompt}"\n\nWrite alt text in ${langName} that describes the image content for accessibility and SEO.`,
      100
    );
    const altText = altResult.trim().replace(/"/g, "'");

    res.json({
      ok: true,
      filename,
      path: `/images/blog/${filename}`,
      altText,
      prompt: imagePrompt,
      size: `${(stats.size / 1024).toFixed(1)} KB`
    });
  } catch (err) {
    console.error('[Image]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GSC Indexing ───
const GSC_KEY_PATH = path.join(LANDING_ROOT, 'gsc-key.json');
const GSC_CACHE_PATH = path.join(LANDING_ROOT, '.gsc-cache.json');
const SITEMAP_PATH_GSC = path.join(DIST_DIR, 'sitemap.xml');
const SITE_URL_GSC = 'https://healthdesk.site';

function loadGscCache() {
  if (fs.existsSync(GSC_CACHE_PATH)) return JSON.parse(fs.readFileSync(GSC_CACHE_PATH, 'utf8'));
  return {};
}

function saveGscCache(cache) {
  fs.writeFileSync(GSC_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

function parseSitemapUrls() {
  if (!fs.existsSync(SITEMAP_PATH_GSC)) return [];
  const xml = fs.readFileSync(SITEMAP_PATH_GSC, 'utf8');
  const urls = [];
  const blocks = xml.split('<url>').slice(1);
  for (const block of blocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    const modMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (locMatch) urls.push({ url: locMatch[1], lastmod: modMatch ? modMatch[1] : null });
  }
  return urls;
}

// API: GSC status — show all URLs with indexing status
app.get('/api/gsc/status', (req, res) => {
  const hasKey = fs.existsSync(GSC_KEY_PATH);
  const hasSitemap = fs.existsSync(SITEMAP_PATH_GSC);
  if (!hasKey) return res.json({ configured: false, error: 'Brak gsc-key.json' });
  if (!hasSitemap) return res.json({ configured: true, error: 'Brak dist/sitemap.xml — uruchom Build' });

  const cache = loadGscCache();
  const sitemapUrls = parseSitemapUrls();

  const urls = sitemapUrls.map(u => {
    const cached = cache[u.url];
    const needsUpdate = !cached || (u.lastmod && cached.lastmod !== u.lastmod);
    return {
      url: u.url,
      lastmod: u.lastmod,
      notifiedAt: cached ? cached.notifiedAt : null,
      status: !cached ? 'new' : needsUpdate ? 'changed' : 'ok'
    };
  });

  const stats = {
    total: urls.length,
    ok: urls.filter(u => u.status === 'ok').length,
    new: urls.filter(u => u.status === 'new').length,
    changed: urls.filter(u => u.status === 'changed').length
  };

  res.json({ configured: true, urls, stats });
});

// API: GSC submit — send URLs to Google Indexing API
app.post('/api/gsc/submit', async (req, res) => {
  if (!fs.existsSync(GSC_KEY_PATH)) return res.status(400).json({ error: 'Brak gsc-key.json' });

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({ keyFile: GSC_KEY_PATH, scopes: ['https://www.googleapis.com/auth/indexing'] });
  const indexing = google.indexing({ version: 'v3', auth });

  const { urls: requestedUrls } = req.body; // optional: specific URLs
  const sitemapUrls = parseSitemapUrls();
  const cache = loadGscCache();

  let toSubmit;
  if (requestedUrls && requestedUrls.length) {
    toSubmit = requestedUrls;
  } else {
    // Submit new/changed only
    toSubmit = sitemapUrls
      .filter(u => {
        const cached = cache[u.url];
        return !cached || (u.lastmod && cached.lastmod !== u.lastmod);
      })
      .map(u => u.url);
  }

  if (toSubmit.length === 0) return res.json({ submitted: 0, results: [], message: 'Wszystko aktualne' });

  const results = [];
  const urlLastmodMap = {};
  sitemapUrls.forEach(u => { urlLastmodMap[u.url] = u.lastmod; });

  for (const url of toSubmit) {
    try {
      await indexing.urlNotifications.publish({ requestBody: { url, type: 'URL_UPDATED' } });
      cache[url] = { notifiedAt: new Date().toISOString(), lastmod: urlLastmodMap[url] || null };
      results.push({ url, status: 'ok' });
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      results.push({ url, status: 'error', error: msg });
    }
    // Rate limit
    if (toSubmit.length > 1) await new Promise(r => setTimeout(r, 500));
  }

  saveGscCache(cache);
  res.json({
    submitted: results.filter(r => r.status === 'ok').length,
    errors: results.filter(r => r.status === 'error').length,
    results
  });
});

// ─── Start ───
const server = app.listen(PORT, () => {
  console.log(`\n  Blog Studio running at http://localhost:${PORT}\n`);
  console.log(`  Blog dir:  ${BLOG_DIR}`);
  console.log(`  Dist dir:  ${DIST_DIR}`);
  console.log(`  Studio DB: ${STUDIO_DATA}\n`);
});
server.timeout = 300000;       // 5 min
server.keepAliveTimeout = 300000;
