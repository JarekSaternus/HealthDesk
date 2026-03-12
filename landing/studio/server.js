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

// ─── Language name mapping ───
const LANG_NAMES = {
  pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French',
  it: 'Italian', 'pt-BR': 'Brazilian Portuguese', ja: 'Japanese',
  'zh-CN': 'Simplified Chinese', ko: 'Korean', tr: 'Turkish', ru: 'Russian',
  nl: 'Dutch', sv: 'Swedish', pt: 'Portuguese', zh: 'Chinese'
};
function getLangName(lang) { return LANG_NAMES[lang] || lang; }

// ─── Claude API ───
function getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return key;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'studio.json'), 'utf8'));
    return data.anthropic_api_key || '';
  } catch { return ''; }
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 2000, { model = 'sonnet' } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY configured');

  const modelId = model === 'haiku' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
  console.log(`[AI] Calling ${model === 'haiku' ? 'Haiku' : 'Sonnet'} (max_tokens=${maxTokens})...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 300s timeout

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: modelId,
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
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to fix truncated JSON by closing open structures
    let fixed = cleaned;
    // Count open/close braces and brackets
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    // Remove trailing comma or incomplete key-value
    fixed = fixed.replace(/,\s*$/, '');
    fixed = fixed.replace(/,\s*"[^"]*"?\s*$/, '');
    // Close open strings
    const quotes = (fixed.match(/"/g) || []).length;
    if (quotes % 2 !== 0) fixed += '"';
    // Close structures
    for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      throw new Error(`${e.message} (auto-fix also failed)`);
    }
  }
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
  if (frontmatter.keyword) {
    yamlLines.push(`keyword: "${frontmatter.keyword.replace(/"/g, '\\"')}"`);
  }
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

  // Auto-track article focus keyword
  syncArticleKeyword(lang, actualSlug, frontmatter.keyword);

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
// Custom dictionary — words to ignore in grammar check
const CUSTOM_DICTIONARY = [
  'Pomodoro', 'pomodoro', 'Cirillo', 'HealthDesk', 'healthdesk',
  'Todoist', 'Notion', 'GTD', 'Draugiem', 'DeskTime',
  'Stretchly', 'Workrave', 'EyeLeo', 'Pomy',
  'ultradian', 'ultradiańskimi', 'mikroprzerwy', 'mikro-ćwiczenia',
  'time blocking', 'blockingiem', 'deep work', 'flow',
  'Optometric', 'Association', 'Irvine', 'Illinois',
  'Getting', 'Things', 'Done', 'Frog', 'Eat',
  'Technique', 'Journal', 'Applied', 'Psychology', 'Experimental',
  'University', 'American', 'California', 'Microsoft', 'Research'
];

app.post('/api/check/grammar', async (req, res) => {
  const { text, lang } = req.body;
  const ltLang = lang === 'pl' ? 'pl-PL' : lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es' : lang;

  try {
    const params = new URLSearchParams({ text, language: ltLang, enabledOnly: 'false' });
    // Disable noisy rule categories
    params.set('disabledCategories', 'TYPOGRAPHY');

    const response = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const data = await response.json();

    // Filter out false positives: matches where the flagged word is in our dictionary
    if (data.matches) {
      const dictSet = new Set(CUSTOM_DICTIONARY.map(w => w.toLowerCase()));
      data.matches = data.matches.filter(m => {
        const flagged = text.substring(m.offset, m.offset + m.length).trim();
        // Skip if flagged text is a known word
        if (dictSet.has(flagged.toLowerCase())) return false;
        // Skip if flagged text contains a known word (for multi-word matches)
        if (CUSTOM_DICTIONARY.some(w => flagged.toLowerCase().includes(w.toLowerCase()))) return false;
        // Skip Polish curly quote "unmatched" warnings (typographic quotes „")
        if (m.rule && m.rule.id && m.rule.id.includes('NIESP') && (flagged === '„' || flagged === '"')) return false;
        return true;
      });
    }

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
      // Auto-update status to 'published' for all non-draft articles
      const studio = loadStudioData();
      let updated = 0;
      for (const key of Object.keys(studio.articles || {})) {
        const status = studio.articles[key].status;
        if (status && status !== 'published' && status !== 'idea') {
          studio.articles[key].status = 'published';
          updated++;
        }
      }
      if (updated > 0) {
        saveStudioData(studio);
        console.log(`[Deploy] Updated ${updated} articles to 'published'`);
      }
      res.json({ ok: true, output: stdout, publishedCount: updated });
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
  fr: { gl: 'fr', hl: 'fr' },
  it: { gl: 'it', hl: 'it' },
  'pt-BR': { gl: 'br', hl: 'pt-BR' },
  ja: { gl: 'jp', hl: 'ja' },
  'zh-CN': { gl: 'cn', hl: 'zh-CN' },
  ko: { gl: 'kr', hl: 'ko' },
  tr: { gl: 'tr', hl: 'tr' },
  ru: { gl: 'ru', hl: 'ru' }
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

// ─── Helper: Keyword search ───
async function doKeywordSearch(query, lang) {
  const locale = LANG_MAP[lang] || LANG_MAP.en;
  console.log(`[Keywords] Searching "${query}" (${lang})...`);

  const [searchData, autocompleteData] = await Promise.all([
    serperRequest('search', { q: query, gl: locale.gl, hl: locale.hl, num: 5 }),
    serperRequest('autocomplete', { q: query, gl: locale.gl, hl: locale.hl })
  ]);

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
  return result;
}

// ─── API: Keyword search (Serper) ───
app.post('/api/keywords/search', async (req, res) => {
  const { query, lang } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  try {
    res.json(await doKeywordSearch(query, lang));
  } catch (err) {
    console.error(`[Keywords] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: Keyword AI analysis ───
async function doKeywordAnalyze(query, lang, serp) {
  const langName = getLangName(lang);

  const serpSummary = (serp.organic || []).map((r, i) =>
    `${i+1}. "${r.title}" — ${r.link}\n   ${r.snippet}`
  ).join('\n');

  const paa = (serp.peopleAlsoAsk || []).map(q => `- ${q}`).join('\n');
  const related = (serp.relatedSearches || []).join(', ');
  const autocomplete = (serp.autocomplete || []).join(', ');

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
    1000, { model: 'haiku' }
  );
  return parseJsonResponse(result);
}

// ─── API: Keyword AI analysis ───
app.post('/api/keywords/analyze', async (req, res) => {
  const { query, lang, serp } = req.body;
  if (!query || !serp) return res.status(400).json({ error: 'query and serp data required' });
  try {
    res.json(await doKeywordAnalyze(query, lang, serp));
  } catch (err) {
    console.error(`[Keywords Analyze] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: AI outline ───
async function doOutline(keyword, lang) {
  const langName = getLangName(lang);
  const result = await callClaude(
    `You are an SEO content strategist for HealthDesk, a desktop wellness app (break reminders, eye exercises, water tracking, activity monitoring). Generate blog article outlines optimized for search engines.`,
    `Generate a blog article outline for the keyword: "${keyword}"
Language: ${langName}
CRITICAL: ALL text (title, description, headings, tags) MUST be written in ${langName}. Do NOT use English unless the target language is English.
Requirements:
- Title (50-60 characters, include keyword, in ${langName})
- Meta description (120-160 characters, in ${langName})
- 5-7 H2 headings in ${langName} (at least 2 as questions for featured snippets)
- 2-3 H3 subheadings under each H2, in ${langName}
- Suggested tags in ${langName} (3-5)
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
Return ONLY valid JSON, no markdown fences.`,
    2000, { model: 'haiku' }
  );
  return parseJsonResponse(result);
}

// ─── AI: Generate outline from keyword ───
app.post('/api/ai/outline', async (req, res) => {
  const { keyword, lang } = req.body;
  try {
    res.json(await doOutline(keyword, lang));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Draft: progress tracking ───
let draftProgress = null; // { slug, lang, title, chunk, totalChunks, sections, status, startedAt, words }

app.get('/api/ai/draft/status', (req, res) => {
  res.json(draftProgress || { status: 'idle' });
});

// ─── Helper: AI draft (chunked writing + FAQ) ───
async function doDraft(title, description, outline, lang, keyword, slug, persona) {
  const langName = getLangName(lang);

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

  const systemPrompt = `You are a health & productivity blog writer for HealthDesk (desktop wellness app). Write ENTIRELY in ${langName} — every word, heading, sentence must be in ${langName}. NEVER use English (unless the target language IS English). Your goal is to produce articles that read as if written by a knowledgeable native ${langName} speaker — NOT a generic AI.

VOICE & TONE:
- Write like a real person sharing expertise — use "I", share brief personal observations or anecdotes (e.g. "I noticed that…", "In my experience…", "I've seen this with clients…")
- Vary paragraph lengths deliberately: mix 1-sentence punchy paragraphs with longer 4-5 sentence ones. Asymmetry is key.
- Vary sentence lengths: mix short punchy sentences with longer complex ones. Monotonous rhythm = AI tell.
- Include at least one moment of honest friction per article — a counterargument, limitation, or "this doesn't work for everyone" caveat
- Ask rhetorical questions to engage the reader (2-3 per article max, not in every section)
- Use 1 colloquial/informal expression per article to break the "textbook" feel (e.g. "let's be honest", "sounds great on paper, but…")
- Use bold sparingly — max 3-4 bolded terms per 1000 words. Bold is the exception, not the norm.

STRUCTURE:
- INTRO: Start from the reader's problem, a question, or a brief anecdote — NEVER from a definition ("X is a technique that…")
- First paragraph after each H2: concise answer (40-60 words) — optimized for featured snippets. But vary how you open — not every section should start the same way.
- Vary section structure — NOT every section should follow the same pattern. Mix: stories → data, data → practical tip, question → answer → nuance. Sections should have DIFFERENT lengths (some 2 paragraphs, some 5).
- Use H2 headings phrased as questions to maximize FAQ schema extraction
- Include at least ONE markdown comparison/summary table per article (use | syntax)
- OUTRO: End with a concrete takeaway or reflection — NEVER with "In summary…", "To conclude…", "In today's fast-paced world…"
- If a list has only 3 items, write it as a sentence instead of bullet points

DATA & STATS:
- Max 3-4 statistics/data points in the ENTIRE article — the rest should be observations and experience
- Always add an interpreting sentence after a statistic (don't just drop numbers)
- Add context: "this 2022 study…", "though the sample was small…"
- Cite external sources with real links: [Journal name](https://doi.org/...), [WHO](https://www.who.int/...)
- Never repeat the same statistic or data point in different sections

LINKS:
- Link to HealthDesk ONLY 2-3 times in the ENTIRE article, naturally where truly relevant (link format: [HealthDesk](https://healthdesk.site/${lang}/))
- Do NOT force a HealthDesk mention in every section. Do NOT start or end the article with product promotion.
- Do NOT end sections with a CTA to the product

SEO:
- Use the target keyword naturally — max 4-5 exact matches per 2000 words. Use synonyms and related terms for the rest ("technique", "system", "approach", "this method").
- Do NOT write a conclusion unless explicitly told to

BANNED PHRASES (never use these — they are AI fingerprints):
"it's worth noting", "it goes without saying", "in today's fast-paced world", "a key aspect is", "furthermore,", "moreover,", "it's important to highlight", "without a doubt", "for this reason", "in conclusion", "to summarize", "as we all know", "needless to say", "it should be noted that", "in the modern era"
Equivalent banned phrases in Polish: "warto zauważyć", "nie ulega wątpliwości", "w dzisiejszym dynamicznym świecie", "kluczowym aspektem jest", "co więcej,", "ponadto,", "warto podkreślić, że", "z tego względu", "podsumowując", "jak wszyscy wiemy", "nie trzeba dodawać", "należy zauważyć, że"
Equivalent banned phrases in German: "es ist erwähnenswert", "zweifellos", "in der heutigen schnelllebigen Welt", "ein wesentlicher Aspekt ist", "darüber hinaus", "zusammenfassend", "es sei darauf hingewiesen"
Equivalent banned phrases in Spanish: "cabe destacar", "sin lugar a dudas", "en el mundo actual", "un aspecto clave es", "además,", "en resumen", "es importante señalar"
Equivalent banned phrases in French: "il convient de noter", "sans aucun doute", "dans le monde d'aujourd'hui", "un aspect clé est", "de plus,", "en résumé", "il est important de souligner"`;

  console.log(`[AI Draft] Generating in ${chunks.length} chunks (${outline.length} sections total)`);

  draftProgress = {
    slug: slug || '', lang, title, chunk: 0, totalChunks: chunks.length,
    sections: '', status: 'generating', startedAt: Date.now(), words: 0
  };

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

    draftProgress.chunk = ci + 1;
    draftProgress.sections = chunk.map(s => s.h2).join(', ');

    console.log(`[AI Draft] Chunk ${ci + 1}/${chunks.length}: ${draftProgress.sections}`);

    const chunkStyleHints = [
      'Start this chunk with an engaging anecdote, observation, or surprising fact.',
      'Open with data or a statistic, then pivot to practical advice.',
      'Start with a rhetorical question that hooks the reader.',
      'Begin with a common misconception, then debunk it.'
    ];
    const styleHint = chunkStyleHints[ci % chunkStyleHints.length];

    const result = await callClaude(
      systemPrompt,
      `Write sections ${ci * CHUNK_SIZE + 1}-${ci * CHUNK_SIZE + chunk.length} of a blog article in Markdown.

Article title: ${title}
Keyword: ${keyword || title}
Description: ${description}${persona ? `\nPerspective/persona: Write as a ${persona}` : ''}

Full outline (for context):
${fullOutlineText}

NOW WRITE ONLY THESE SECTIONS:
${chunkOutline}
${prevContext}
${conclusionNote}

Style hint for this chunk: ${styleHint}

Write ~${isLast ? '150-250' : '200-350'} words per H2 section. Start directly with ## heading. No frontmatter.`,
      2000
    );

    parts.push(result.trim());
    draftProgress.words = parts.join('\n\n').split(/\s+/).length;
  }

  const markdown = parts.join('\n\n');
  console.log(`[AI Draft] Done: ${markdown.split(/\s+/).length} words total`);

  // Auto-generate FAQ from article content
  let faqYaml = '';
  try {
    draftProgress.sections = 'Generating FAQ...';
    const faqResult = await callClaude(
      `You extract FAQ pairs from blog articles. Return ONLY valid JSON.`,
      `Extract 3-5 frequently asked questions and concise answers from this article. Each answer should be 1-2 sentences (max 200 chars).

Article title: ${title}
Article content (first 2000 chars):
${markdown.slice(0, 2000)}

Return ONLY valid JSON:
{ "faq": [ { "q": "Question?", "a": "Answer." } ] }`,
      800
    );
    const faqData = parseJsonResponse(faqResult);
    if (faqData.faq && faqData.faq.length > 0) {
      faqYaml = 'faq:\n' + faqData.faq.map(f =>
        `  - q: "${(f.q || '').replace(/"/g, '\\"')}"\n    a: "${(f.a || '').replace(/"/g, '\\"')}"`
      ).join('\n');
      console.log(`[AI Draft] Generated ${faqData.faq.length} FAQ pairs`);
    }
  } catch (faqErr) {
    console.error(`[AI Draft] FAQ generation failed: ${faqErr.message}`);
  }

  // Auto-save draft to disk
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
        `keyword: "${(keyword || '').replace(/"/g, '\\"')}"`,
        `tags: []`,
        `lang: ${lang}`,
        faqYaml,
        '---'
      ].filter(Boolean).join('\n');
      fs.writeFileSync(path.join(langDir, `${slug}.md`), frontmatterYaml + '\n' + markdown, 'utf8');
      console.log(`[AI Draft] Auto-saved to ${lang}/${slug}.md`);
    } catch (saveErr) {
      console.error(`[AI Draft] Auto-save failed: ${saveErr.message}`);
    }
  }

  draftProgress.status = 'done';
  draftProgress.words = markdown.split(/\s+/).length;

  return { markdown, faqYaml };
}

// ─── AI: Write full draft from outline ───
app.post('/api/ai/draft', async (req, res) => {
  const { title, description, outline, lang, keyword, slug, persona } = req.body;
  try {
    const result = await doDraft(title, description, outline, lang, keyword, slug, persona);
    res.json({ markdown: result.markdown });
    setTimeout(() => { if (draftProgress && draftProgress.status === 'done') draftProgress = null; }, 30000);
  } catch (err) {
    if (draftProgress) { draftProgress.status = 'error'; draftProgress.error = err.message; }
    res.status(500).json({ error: err.message });
    setTimeout(() => { draftProgress = null; }, 30000);
  }
});

// ─── Helper: AI description ───
async function doDescription(markdown, title, lang) {
  const langName = getLangName(lang);
  const result = await callClaude(
    'You are an SEO specialist. Generate meta descriptions that are compelling, include the main keyword, and drive clicks.',
    `Generate a meta description (120-160 characters) in ${langName} for this article:
Title: ${title}
Content preview: ${markdown.slice(0, 500)}

Return ONLY the description text, nothing else.`,
    200, { model: 'haiku' }
  );
  return result.trim();
}

// ─── AI: Suggest meta description ───
app.post('/api/ai/description', async (req, res) => {
  const { markdown, title, lang } = req.body;
  try {
    const description = await doDescription(markdown, title, lang);
    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: Humanize article ───
const LANG_GUIDELINES = {
  pl: {
    name: 'Polish',
    formalPhrases: `"warto zauważyć", "nie ulega wątpliwości", "w dzisiejszych czasach", "kluczowym aspektem jest", "nie sposób nie wspomnieć", "z całą pewnością", "w związku z powyższym", "ponadto", "co więcej", "należy podkreślić", "w kontekście", "biorąc pod uwagę", "nie da się ukryć, że"`,
    personalPhrases: `"z mojego doświadczenia", "sam/sama to testowałem/am", "przyznam, że na początku…", "u mnie sprawdza się", "powiem szczerze"`,
    softStats: `"wielu użytkowników zauważa, że…", "z praktyki wynika, że…", "badania sugerują, że…"`,
    style: `- Use "ty" form (2nd person singular informal), NOT "Państwo" or "Pan/Pani"
- Use natural Polish word order — don't calque English sentence structures
- Contractions are fine: "nie da się" instead of "nie jest to możliwe"
- Rhetorical questions: "Znasz to uczucie, gdy...?", "Ile razy zdarzyło ci się...?"
- Polish allows longer sentences than English — but still vary them
- Avoid unnecessary Anglicisms: use "przerwa" not "break", "technika" not overused "metoda"
- Colloquial interjections: "no i co?", "serio?", "brzmi znajomo?", "no właśnie"
- Polish readers appreciate warmth and directness — write like talking to a friend over coffee`,
  },
  en: {
    name: 'English',
    formalPhrases: `"it's worth noting that", "there is no doubt", "for this reason", "furthermore", "moreover", "it should be highlighted that", "in today's dynamic world", "a key aspect is", "needless to say", "it goes without saying", "at the end of the day", "in conclusion"`,
    personalPhrases: `"from my experience", "I've tested this myself", "I'll admit, at first…", "here's what works for me"`,
    softStats: `"many users report that…", "research suggests that…", "from what we've seen…"`,
    style: `- Use conversational contractions: "don't", "isn't", "we've", "you'll"
- Mix short punchy sentences with longer ones — English thrives on rhythm
- Use active voice: "you'll notice" not "it can be noticed"
- Rhetorical questions: "Ever noticed how...?", "Sound familiar?"
- Colloquial: "here's the thing", "turns out", "spoiler alert", "let's be honest"
- Keep consistent American English spelling`,
  },
  de: {
    name: 'German',
    formalPhrases: `"es ist erwähnenswert", "zweifellos", "darüber hinaus", "des Weiteren", "es sei darauf hingewiesen", "in der heutigen Zeit", "ein wesentlicher Aspekt", "selbstverständlich", "es versteht sich von selbst", "im Folgenden", "abschließend lässt sich sagen", "es ist unbestritten"`,
    personalPhrases: `"aus meiner Erfahrung", "ich habe das selbst getestet", "ich gebe zu, anfangs…", "was bei mir funktioniert", "ganz ehrlich"`,
    softStats: `"viele Nutzer berichten, dass…", "Studien deuten darauf hin, dass…", "in der Praxis zeigt sich…"`,
    style: `- Use "du" form (informal) for blog content, NOT "Sie"
- Simplify subordinate clause chains — German AI text tends to nest too deeply
- Use natural compound words: "Arbeitsplatzergonomie", "Bildschirmarbeit"
- Avoid direct English calques — use German idioms: "Hand aufs Herz", "mal ehrlich"
- Rhetorical questions: "Kennst du das Gefühl, wenn...?", "Kommt dir das bekannt vor?"
- Colloquial: "mal ehrlich", "und zwar", "klingt vertraut?", "Spaß beiseite"
- German readers expect depth — don't oversimplify, but break up dense passages
- Avoid overusing "man" (impersonal) — address the reader directly with "du"`,
  },
  es: {
    name: 'Spanish',
    formalPhrases: `"cabe destacar", "sin lugar a dudas", "por esta razón", "además", "asimismo", "es importante señalar que", "en la actualidad", "un aspecto clave es", "huelga decir", "dicho lo anterior", "en definitiva", "resulta evidente que"`,
    personalPhrases: `"por experiencia propia", "yo mismo lo he probado", "te confieso que al principio…", "a mí me funciona", "siendo honesto"`,
    softStats: `"muchos usuarios notan que…", "los estudios sugieren que…", "en la práctica se observa que…"`,
    style: `- Use "tú" form (informal), NOT "usted"
- Spanish is naturally more verbose — embrace it, but vary sentence lengths
- Rhetorical questions: "¿Te suena?", "¿Cuántas veces te ha pasado que...?"
- Avoid anglicisms: use "enlace" not "link", "pantalla" not "display"
- Emphatic structures: "Lo que sí funciona es…", "El problema real es que…"
- Colloquial: "la verdad es que", "ojo", "vamos a lo importante", "seamos sinceros"
- Don't forget inverted punctuation: ¿ ¡
- Latin American vs Spain: prefer neutral Spanish that works for both`,
  },
  fr: {
    name: 'French',
    formalPhrases: `"il convient de noter", "sans aucun doute", "c'est pourquoi", "en outre", "de surcroît", "il est important de souligner", "dans le monde actuel", "un aspect clé est", "il va sans dire", "en définitive", "force est de constater", "il est indéniable que"`,
    personalPhrases: `"d'après mon expérience", "j'ai testé cela moi-même", "j'avoue qu'au début…", "ce qui marche pour moi", "honnêtement"`,
    softStats: `"beaucoup d'utilisateurs remarquent que…", "les études suggèrent que…", "dans la pratique, on observe que…"`,
    style: `- Use "tu" form for blog content — casual, direct, like talking to a colleague
- French values elegance — avoid repeating the same word in nearby sentences, use synonyms
- Rhetorical questions: "Tu connais cette sensation quand...?", "Ça te parle?"
- Avoid English borrowings when French alternatives exist
- French-specific expressions: "entre nous", "avouons-le", "c'est là que ça se complique"
- Colloquial: "bon", "du coup", "en gros", "soyons honnêtes"
- French readers expect intellectual engagement — don't dumb things down
- Liaison and rhythm matter — read sentences aloud mentally to check flow`,
  },
  it: {
    name: 'Italian',
    formalPhrases: `"è opportuno sottolineare", "non vi è dubbio", "in quest'ottica", "inoltre", "altresì", "è importante evidenziare che", "nel contesto attuale", "un aspetto fondamentale è", "va da sé", "in conclusione", "è innegabile che", "alla luce di quanto sopra"`,
    personalPhrases: `"dalla mia esperienza", "l'ho provato personalmente", "ammetto che all'inizio…", "per me funziona", "onestamente"`,
    softStats: `"molti utenti notano che…", "gli studi suggeriscono che…", "nella pratica si osserva che…"`,
    style: `- Use "tu" form (informal), NOT "Lei"
- Italian loves rhythm and melody — vary sentence length for musicality
- Rhetorical questions: "Ti è mai capitato di...?", "Ti suona familiare?"
- Avoid anglicisms: use "collegamento" not "link", "schermo" not "display"
- Colloquial: "la verità è che", "occhio", "andiamo al sodo", "siamo onesti"
- Italian readers appreciate warmth and expressiveness — don't be too dry
- Use emphatic structures: "Il punto è che…", "Quello che funziona davvero è…"`,
  },
  'pt-BR': {
    name: 'Brazilian Portuguese',
    formalPhrases: `"vale ressaltar que", "não há dúvida de que", "nesse sentido", "ademais", "outrossim", "é importante destacar que", "no cenário atual", "um aspecto fundamental é", "escusado será dizer", "em suma", "é inegável que", "diante do exposto"`,
    personalPhrases: `"pela minha experiência", "eu mesmo testei isso", "confesso que no começo…", "o que funciona pra mim", "sinceramente"`,
    softStats: `"muitos usuários percebem que…", "pesquisas sugerem que…", "na prática, observa-se que…"`,
    style: `- Use "você" form (Brazilian informal), NOT "o senhor/a senhora"
- Brazilian Portuguese is naturally warm and conversational — embrace it
- Rhetorical questions: "Já aconteceu com você de...?", "Parece familiar?"
- Avoid excessive anglicisms: use "tela" not "display", "publicação" not "post"
- Colloquial: "a real é que", "ó", "bora lá", "vamos ser sinceros", "tá ligado?"
- Use Brazilian expressions naturally: "dá pra", "tipo assim", "na moral"
- Brazilian readers prefer a light, friendly tone — como papo de amigo`,
  },
  ja: {
    name: 'Japanese',
    formalPhrases: `"注目に値する", "疑いの余地はない", "この観点から", "さらに", "加えて", "強調すべきは", "現代社会において", "重要な側面は", "言うまでもなく", "結論として", "否定できない事実として", "以上を踏まえて"`,
    personalPhrases: `"私の経験では", "実際に試してみて", "正直に言うと最初は…", "個人的にうまくいったのは", "率直に言って"`,
    softStats: `"多くのユーザーが感じているのは…", "研究が示唆するのは…", "実際のところ…"`,
    style: `- Use です/ます form but keep it conversational, not stiff
- Mix in casual expressions: "実はね", "ちょっと意外かも", "わかる気がする"
- Japanese readers appreciate practical, actionable advice
- Use appropriate particles and sentence-ending forms for friendly tone
- Rhetorical questions: "こんな経験ありませんか？", "心当たりありますよね？"
- Break long sentences — Japanese AI text tends to create overly complex structures
- Use katakana for established loanwords naturally`,
  },
  'zh-CN': {
    name: 'Simplified Chinese',
    formalPhrases: `"值得注意的是", "毫无疑问", "从这个角度来看", "此外", "与此同时", "需要强调的是", "在当今社会", "一个关键方面是", "不言而喻", "总而言之", "不可否认的是", "综上所述"`,
    personalPhrases: `"根据我的经验", "我亲自试过", "说实话一开始…", "对我来说有效的是", "坦白说"`,
    softStats: `"很多用户发现…", "研究表明…", "实际情况是…"`,
    style: `- Use casual but respectful tone — 你 not 您 for blog content
- Chinese AI text overuses four-character idioms (成语) — use sparingly and naturally
- Rhetorical questions: "你有没有过这样的经历？", "是不是听起来很熟悉？"
- Keep sentences shorter than AI typically generates
- Colloquial: "说真的", "你猜怎么着", "重点来了", "话说回来"
- Chinese readers appreciate directness and practical value
- Avoid overly formal or literary register — write like a knowledgeable friend`,
  },
  ko: {
    name: 'Korean',
    formalPhrases: `"주목할 만한 것은", "의심의 여지가 없다", "이러한 관점에서", "더불어", "아울러", "강조해야 할 점은", "현대 사회에서", "핵심적인 측면은", "두말할 나위 없이", "결론적으로", "부인할 수 없는 사실은", "이상을 종합하면"`,
    personalPhrases: `"제 경험상", "직접 해봤는데", "솔직히 처음에는…", "저한테 효과가 있었던 건", "솔직히 말하면"`,
    softStats: `"많은 사용자들이 느끼는 건…", "연구에 따르면…", "실제로 보면…"`,
    style: `- Use 해요체 (polite informal) — not 합니다체 (formal) for blog
- Korean AI text tends to be overly formal — make it conversational
- Rhetorical questions: "이런 경험 있으시죠?", "공감되시나요?"
- Colloquial: "사실은요", "근데 말이에요", "핵심은요", "솔직히"
- Korean readers appreciate relatable, empathetic content
- Mix honorific levels naturally — slight informality builds trust
- Avoid direct translation patterns from English word order`,
  },
  tr: {
    name: 'Turkish',
    formalPhrases: `"belirtmek gerekir ki", "şüphesiz ki", "bu bağlamda", "ayrıca", "bunun yanı sıra", "vurgulanması gereken", "günümüz dünyasında", "temel bir husus", "söylemeye gerek yok ki", "sonuç olarak", "yadsınamaz bir gerçektir ki", "yukarıda belirtildiği üzere"`,
    personalPhrases: `"kendi deneyimimden", "bunu bizzat denedim", "itiraf edeyim başta…", "benim için işe yarayan", "açıkçası"`,
    softStats: `"birçok kullanıcı fark ediyor ki…", "araştırmalar gösteriyor ki…", "pratikte gözlemlenen…"`,
    style: `- Use "sen" form (informal), NOT "siz" for blog content
- Turkish agglutinative structure — avoid overly long compound words
- Rhetorical questions: "Hiç başına geldi mi?", "Tanıdık geldi mi?"
- Colloquial: "açıkçası", "işin aslı", "asıl mesele şu ki", "dürüst olalım"
- Turkish readers appreciate direct, honest communication
- Vary sentence endings — don't always end with -dır/-dir
- Use natural Turkish idioms: "işin püf noktası", "can alıcı nokta"`,
  },
  ru: {
    name: 'Russian',
    formalPhrases: `"стоит отметить, что", "не вызывает сомнений", "в данном контексте", "кроме того", "помимо этого", "необходимо подчеркнуть", "в современном мире", "ключевым аспектом является", "само собой разумеется", "в заключение", "неоспоримым фактом является", "на основании вышеизложенного"`,
    personalPhrases: `"по моему опыту", "я сам это пробовал", "признаюсь, поначалу…", "мне помогает", "честно говоря"`,
    softStats: `"многие пользователи замечают, что…", "исследования показывают, что…", "на практике видно, что…"`,
    style: `- Use "ты" form (informal), NOT "Вы" for blog content
- Russian AI text overuses official/bureaucratic style — make it живой (alive)
- Rhetorical questions: "Знакомо?", "Бывало такое?", "Узнаёшь себя?"
- Colloquial: "на самом деле", "вот в чём фишка", "давай честно", "суть в том, что"
- Russian readers appreciate depth and sincerity — don't be superficial
- Use natural Russian word order — freer than English, use for emphasis
- Avoid канцелярит (bureaucratic language) — it's the biggest AI giveaway in Russian`,
  },
};

async function doHumanize(markdown, lang) {
  const lg = LANG_GUIDELINES[lang] || LANG_GUIDELINES.en;
  console.log(`[AI Humanize] Processing ${markdown?.length || 0} chars in ${lg.name}`);

  const result = await callClaude(
    `You are an experienced ${lg.name}-language editor who humanizes AI-generated content. Write ENTIRELY in ${lg.name}. Your task is to transform the given text so it sounds like it was written by a real person — a ${lg.name}-speaking expert who blogs with passion, not a robot producing content.`,
    `STEP 1: DIAGNOSE — Before editing, analyze the article and list 5-7 specific AI-pattern problems you found (with quotes from the text). Output them as a brief numbered list at the very top, wrapped in <!-- DIAGNOSIS: ... --> HTML comment. Write the diagnosis in ${lg.name}.

STEP 2: FIX — Then output the fully rewritten article applying ALL fixes below.

## 1. STRUCTURE & RHYTHM
- Vary paragraph lengths (mix: 1-sentence, 3-sentence, 5-sentence)
- Vary sentence lengths (mix short punchy with longer complex ones)
- Break the perfect symmetry of sections — not every section should have exactly 3 paragraphs
- Add 1-2 single-sentence paragraphs for dramatic effect
- Remove or relocate duplicate information (AI often repeats the same data in different sections)
- If a list has only 3 items, convert it to a flowing sentence instead

## 2. VOICE & PERSONALITY (${lg.name}-specific rules)
- Add 2-3 personal interjections using natural ${lg.name} phrasing: ${lg.personalPhrases}
- Insert 1 controversial opinion or caveat
- Add 1-2 rhetorical questions directed at the reader
- Insert 1 colloquial/informal expression natural to ${lg.name}
- REMOVE these ${lg.name} AI-filler/formal phrases (AI overuses them): ${lg.formalPhrases}
- Add 1 brief digression or anecdote (even 2 sentences) — this is the most human element
- LANGUAGE-SPECIFIC STYLE RULES:
${lg.style}

## 3. FORMATTING (anti-AI)
- Reduce bolds — max 3-4 per 1000 words (AI overuses bold)
- Don't bold every other paragraph — bold should be the exception
- Don't start every section with a defining sentence ("X is a technique that…")
- Vary how paragraphs open (don't start from the same pattern)
- Don't end every section with a CTA or summary

## 4. DATA & SOURCES
- Max 3-4 statistics in the ENTIRE article — replace the rest with soft ${lg.name} observations: ${lg.softStats}
- Add context to statistics ("this 2022 study…", "though the numbers may vary")
- Don't drop stats without commentary — add an interpreting sentence
- When studies are mentioned without links, add real external source links (WHO, PubMed, university domains)

## 5. INTERNAL LINKS / PRODUCT
- Max 2-3 product mentions in the entire article
- Product mentions should arise from context, not be forced
- Don't start or end the article with product promotion

## 6. KEYWORDS (anti-stuffing)
- Check if the main keyword appears more than 5-7 times per 2000 words — if so, replace excess with ${lg.name} synonyms
- Use natural ${lg.name} synonym variants for the main keyword
- Keywords should sound natural in the sentence — if grammar bends to fit the phrase, rewrite it

## 7. INTRO & OUTRO
- Intro should NOT be encyclopedic — if it starts with a definition, rewrite to start from the reader's problem, a question, or brief story
- Outro should NOT be a formulaic summary — end with a concrete takeaway, call to action, or reflection

PRESERVE:
- All ## and ### headings exactly as they are
- All tables (| syntax)
- All existing external links
- Overall article structure and factual accuracy
- Markdown formatting syntax

Return the diagnosis comment followed by the rewritten article. No markdown fences. Start with <!-- DIAGNOSIS: then the article starting with ## heading.

ARTICLE:
${markdown}`,
    8000
  );
  let cleaned = result.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:markdown)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  // Strip diagnosis comment for clean output
  const articleText = cleaned.replace(/<!--\s*DIAGNOSIS:\s*[\s\S]*?-->\s*/, '').trim();
  console.log(`[AI Humanize] Done: ${articleText.length} chars`);
  return { markdown: cleaned, articleText };
}

// ─── AI: Humanize article (remove AI patterns) ───
app.post('/api/ai/humanize', async (req, res) => {
  const { markdown, lang } = req.body;
  try {
    const result = await doHumanize(markdown, lang);
    res.json({ markdown: result.markdown });
  } catch (err) {
    console.error(`[AI Humanize] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: Audit article ───
async function doAudit(markdown, lang) {
  const langName = getLangName(lang);
  console.log(`[AI Audit] Analyzing ${markdown?.length || 0} chars in ${langName}`);

  const result = await callClaude(
    `You analyze blog articles for "AI fingerprints" — typical traits of AI-generated content that reduce reader trust and may trigger Google's Helpful Content Update penalties. Respond in ${langName}.`,
    `Analyze this blog article for AI-generated content patterns. Score it 1-10 (1 = fully human, 10 = obvious AI) and justify your assessment.

CHECK THESE 10 DIMENSIONS (score each 1-10):
1. Structure symmetry — do sections have identical structure/length?
2. Data/fact repetition — same stats repeated in different sections?
3. Bold overuse — bolded terms in almost every paragraph?
4. Lack of personal voice — no anecdotes, opinions, digressions?
5. Formulaic phrases — "it's worth noting", "a key aspect", "furthermore"?
6. Stats in every section — data dumping without interpretation?
7. No controversy or caveats — everything presented as universally true?
8. Encyclopedic intro — starts with a definition instead of a problem?
9. Formulaic outro — "In summary…", "To conclude…"?
10. Keyword stuffing — main keyword appearing every 100 words?

RESPONSE FORMAT (use exactly this JSON structure):
{
  "score": 7,
  "dimensions": [
    { "name": "Structure symmetry", "score": 8, "detail": "All 5 sections follow identical pattern: definition → 3 paragraphs → stat" },
    { "name": "Bold overuse", "score": 9, "detail": "23 bolded phrases in 1500 words" }
  ],
  "top_problems": [
    { "problem": "Repetition of '23 minutes to regain focus'", "quote": "...appears in sections 2 and 5...", "fix": "Keep only in section 2, replace in section 5 with a different supporting point" }
  ],
  "summary": "The article scores 7/10 on the AI scale. Main issues: uniform structure, excessive bolding, and repeated statistics."
}

Return ONLY valid JSON, no markdown fences.

ARTICLE TO AUDIT:
${markdown}`,
    3000, { model: 'haiku' }
  );

  const parsed = parseJsonResponse(result);
  console.log(`[AI Audit] Score: ${parsed.score}/10`);
  return parsed;
}

// ─── AI: Audit article for AI fingerprints ───
app.post('/api/ai/audit', async (req, res) => {
  const { markdown, lang } = req.body;
  try {
    res.json(await doAudit(markdown, lang));
  } catch (err) {
    console.error(`[AI Audit] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: Full grammar fix (LanguageTool + AI) ───
// Languages supported by LanguageTool API
const LT_SUPPORTED_LANGS = new Set(['pl', 'en', 'de', 'fr', 'es', 'it', 'pt-BR', 'nl', 'ru', 'sv']);

async function doGrammarFix(markdown, lang) {
  const langName = getLangName(lang);

  // Skip LanguageTool for unsupported languages (ja, zh-CN, ko, tr, etc.)
  if (!LT_SUPPORTED_LANGS.has(lang)) {
    console.log(`[Grammar Fix] Skipping LanguageTool for ${lang} (unsupported). Using AI-only fix.`);
    // AI-only grammar fix without LanguageTool
    const result = await callClaude(
      `You are a ${langName} grammar and style editor. Fix grammar, spelling, and punctuation errors in the text below. Preserve all markdown formatting. Return ONLY the corrected markdown text, nothing else.`,
      markdown, 8000, { model: 'haiku' }
    );
    const changed = result !== markdown;
    return { markdown: result || markdown, changed, issueCount: changed ? 1 : 0 };
  }

  const ltLang = lang === 'pl' ? 'pl-PL' : lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es' : lang === 'it' ? 'it' : lang === 'pt-BR' ? 'pt-BR' : lang === 'nl' ? 'nl' : lang === 'ru' ? 'ru-RU' : lang === 'sv' ? 'sv' : lang;

  // Step 1: Get grammar issues from LanguageTool
  const plain = markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`[^`]+`/g, '');

  const params = new URLSearchParams({ text: plain, language: ltLang, enabledOnly: 'false' });
  params.set('disabledCategories', 'TYPOGRAPHY');

  const ltResponse = await fetch('https://api.languagetool.org/v2/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const ltData = await ltResponse.json();

  // Filter false positives
  let matches = ltData.matches || [];
  const dictSet = new Set(CUSTOM_DICTIONARY.map(w => w.toLowerCase()));
  matches = matches.filter(m => {
    const flagged = plain.substring(m.offset, m.offset + m.length).trim();
    if (dictSet.has(flagged.toLowerCase())) return false;
    if (CUSTOM_DICTIONARY.some(w => flagged.toLowerCase().includes(w.toLowerCase()))) return false;
    if (m.rule && m.rule.id && m.rule.id.includes('NIESP') && (flagged === '\u201E' || flagged === '\u201D')) return false;
    return true;
  });

  if (matches.length === 0) {
    console.log('[Grammar Fix] No issues found');
    return { markdown, changed: false, issueCount: 0 };
  }

  const issues = matches.map(m => ({
    message: m.message,
    context: m.context.text.slice(Math.max(0, m.context.offset - 15), m.context.offset + m.context.length + 15),
    suggestion: m.replacements?.slice(0, 2).map(r => r.value).join(' or ') || ''
  }));

  // Step 2: AI fix
  const actionableIssues = issues.filter(i => i.suggestion && i.suggestion.trim()).map((i, idx) =>
    `${idx+1}. Find: "${i.context.trim()}" → Replace with suggestion: "${i.suggestion}". Reason: ${i.message}`
  );
  const otherIssues = issues.filter(i => !i.suggestion || !i.suggestion.trim()).map((i, idx) =>
    `${idx+1}. Issue near: "${i.context.trim()}" — ${i.message}`
  );
  const issueList = [...actionableIssues, ...otherIssues].join('\n');

  console.log(`[Grammar Fix] ${issues.length} issues (${actionableIssues.length} actionable)`);

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
    8000, { model: 'haiku' }
  );

  let cleaned = result.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:markdown)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const changed = cleaned.trim() !== markdown.trim();
  console.log(`[Grammar Fix] Result: ${cleaned.length} chars, changed: ${changed}`);
  return { markdown: cleaned, changed, issueCount: issues.length };
}

// ─── AI: Fix grammar & readability ───
app.post('/api/ai/fix-grammar', async (req, res) => {
  const { markdown, issues, lang } = req.body;
  const langName = getLangName(lang);

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
  const langName = getLangName(lang);

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
  const langName = getLangName(lang);

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

// ─── AI: Internal Linking Suggestions ───
app.post('/api/ai/internal-links', async (req, res) => {
  const { lang, slug } = req.body;
  if (!lang || !slug) return res.status(400).json({ error: 'lang and slug required' });

  const langDir = path.join(BLOG_DIR, lang);
  const filePath = path.join(langDir, slug + '.md');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Article not found' });

  const langName = getLangName(lang);

  try {
    // Load current article
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = fm(raw);
    const articleBody = parsed.body;

    // Load all other articles in same language
    const files = fs.readdirSync(langDir).filter(f => f.endsWith('.md') && f !== slug + '.md');
    const otherArticles = files.map(f => {
      const content = fs.readFileSync(path.join(langDir, f), 'utf8');
      const p = fm(content);
      return {
        slug: f.replace('.md', ''),
        title: p.attributes.title || '',
        description: p.attributes.description || '',
        keyword: p.attributes.keyword || '',
        tags: (p.attributes.tags || []).join(', ')
      };
    }).filter(a => a.title);

    if (otherArticles.length === 0) return res.json({ suggestions: [] });

    const articleList = otherArticles.map(a =>
      `- slug: "${a.slug}" | title: "${a.title}" | description: "${a.description}" | keyword: "${a.keyword}"`
    ).join('\n');

    const baseUrl = `https://healthdesk.site/${lang}/blog/`;

    const result = await callClaude(
      `You are an internal linking specialist for a blog. You find natural anchor text phrases in an article that should link to other articles on the same site. Write in ${langName}.`,
      `Find phrases in this article that naturally match other articles on the site. Each phrase should be an existing substring in the article text — do NOT invent phrases.

Available articles to link to:
${articleList}

Current article content (first 3000 chars):
${articleBody.slice(0, 3000)}

Rules:
- Find 2-6 linking opportunities
- Anchor text must be an EXACT substring from the article
- Each anchor should be 2-5 words, natural reading
- Don't suggest links that already exist in the article
- Prefer phrases closely related to the target article's topic/keyword

Return ONLY valid JSON:
{
  "suggestions": [
    { "anchor": "exact phrase from text", "targetSlug": "slug", "targetTitle": "Title", "reason": "why this link" }
  ]
}`,
      1500
    );

    const data = parseJsonResponse(result);
    // Filter out suggestions where link already exists or anchor not found in text
    const filtered = (data.suggestions || []).filter(s => {
      const url = baseUrl + s.targetSlug + '/';
      s.url = url;
      return articleBody.includes(s.anchor) && !articleBody.includes(url);
    });

    res.json({ suggestions: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI: Create localized version of article ───
app.post('/api/ai/create-version', async (req, res) => {
  const { sourceLang, targetLang, slug, frontmatter, markdown } = req.body;
  const langNames = LANG_NAMES;
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

// ─── Auto-sync article focus keyword → tracked keywords ───
function syncArticleKeyword(lang, slug, keyword) {
  if (!keyword) return 0;
  keyword = keyword.toLowerCase().trim();
  if (!keyword) return 0;

  const studio = loadStudioData();
  if (!studio.tracked_keywords) studio.tracked_keywords = [];

  const targetUrl = `https://healthdesk.site/${lang}/blog/${slug}`;
  const targetPage = `${lang}/blog/${slug}`;

  const exists = studio.tracked_keywords.find(k => k.keyword === keyword && k.lang === lang);
  if (exists) {
    // Update target if changed
    if (exists.targetUrl !== targetUrl) {
      exists.targetUrl = targetUrl;
      exists.targetPage = targetPage;
      saveStudioData(studio);
    }
    return 0;
  }

  studio.tracked_keywords.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    keyword,
    lang,
    targetUrl,
    targetPage,
    addedAt: new Date().toISOString().slice(0, 10),
    history: [],
    source: 'auto'
  });
  saveStudioData(studio);
  return 1;
}

// ─── Keyword Rank Tracker ───

// API: Get tracked keywords
app.get('/api/keywords/tracked', (req, res) => {
  const studio = loadStudioData();
  res.json(studio.tracked_keywords || []);
});

// API: Add tracked keyword
app.post('/api/keywords/tracked', (req, res) => {
  const { keyword, lang, targetUrl, targetPage } = req.body;
  if (!keyword || !lang) return res.status(400).json({ error: 'keyword and lang required' });

  const studio = loadStudioData();
  if (!studio.tracked_keywords) studio.tracked_keywords = [];

  // Check duplicate
  const exists = studio.tracked_keywords.find(k => k.keyword === keyword && k.lang === lang);
  if (exists) return res.status(409).json({ error: 'Keyword already tracked' });

  const entry = {
    id: Date.now().toString(36),
    keyword,
    lang,
    targetUrl: targetUrl || '',
    targetPage: targetPage || '',
    addedAt: new Date().toISOString().slice(0, 10),
    history: []
  };
  studio.tracked_keywords.push(entry);
  saveStudioData(studio);
  res.json(entry);
});

// API: Delete tracked keyword
app.delete('/api/keywords/tracked/:id', (req, res) => {
  const studio = loadStudioData();
  studio.tracked_keywords = (studio.tracked_keywords || []).filter(k => k.id !== req.params.id);
  saveStudioData(studio);
  res.json({ ok: true });
});

// API: Seed tracked keywords from all existing articles + landing pages
app.post('/api/keywords/seed-existing', (req, res) => {
  let totalAdded = 0;

  // 1) Scan all blog articles for focus keyword
  const blogDir = BLOG_DIR;
  if (fs.existsSync(blogDir)) {
    const langs = fs.readdirSync(blogDir).filter(d => fs.statSync(path.join(blogDir, d)).isDirectory());
    for (const lang of langs) {
      const langDir = path.join(blogDir, lang);
      const files = fs.readdirSync(langDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(langDir, file), 'utf8');
        const parsed = fm(content);
        const slug = parsed.attributes.slug || file.replace('.md', '');
        const keyword = parsed.attributes.keyword;
        if (keyword) {
          const added = syncArticleKeyword(lang, slug, keyword);
          totalAdded += added || 0;
        }
      }
    }
  }

  // 2) Landing page keywords (manual)
  const landingKeywords = [
    { keyword: 'przerwy w pracy', lang: 'pl', targetUrl: 'https://healthdesk.site/pl/', targetPage: 'pl/landing' },
    { keyword: 'zdrowie przy komputerze', lang: 'pl', targetUrl: 'https://healthdesk.site/pl/', targetPage: 'pl/landing' },
    { keyword: 'ćwiczenia dla oczu', lang: 'pl', targetUrl: 'https://healthdesk.site/pl/', targetPage: 'pl/landing' },
    { keyword: 'przypomnienie o wodzie', lang: 'pl', targetUrl: 'https://healthdesk.site/pl/', targetPage: 'pl/landing' },
    { keyword: 'ergonomia pracy biurowej', lang: 'pl', targetUrl: 'https://healthdesk.site/pl/', targetPage: 'pl/landing' },
    { keyword: 'work break reminder', lang: 'en', targetUrl: 'https://healthdesk.site/en/', targetPage: 'en/landing' },
    { keyword: 'eye exercise app', lang: 'en', targetUrl: 'https://healthdesk.site/en/', targetPage: 'en/landing' },
    { keyword: 'desk break software', lang: 'en', targetUrl: 'https://healthdesk.site/en/', targetPage: 'en/landing' },
    { keyword: 'water reminder desktop', lang: 'en', targetUrl: 'https://healthdesk.site/en/', targetPage: 'en/landing' },
    { keyword: 'healthy computing habits', lang: 'en', targetUrl: 'https://healthdesk.site/en/', targetPage: 'en/landing' },
  ];

  const studio = loadStudioData();
  if (!studio.tracked_keywords) studio.tracked_keywords = [];

  for (const lk of landingKeywords) {
    const exists = studio.tracked_keywords.find(k => k.keyword === lk.keyword && k.lang === lk.lang);
    if (exists) continue;
    studio.tracked_keywords.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      keyword: lk.keyword,
      lang: lk.lang,
      targetUrl: lk.targetUrl,
      targetPage: lk.targetPage,
      addedAt: new Date().toISOString().slice(0, 10),
      history: [],
      source: 'seed'
    });
    totalAdded++;
  }

  if (totalAdded > 0) saveStudioData(studio);
  res.json({ ok: true, added: totalAdded });
});

// API: Site structure — all pages with their SEO data
app.get('/api/site-structure', (req, res) => {
  const studio = loadStudioData();
  const keywords = studio.tracked_keywords || [];
  const pages = [];

  // Landing pages (12 languages)
  const LANGS = ['pl','en','de','es','fr','it','pt','nl','sv','da','nb','cs'];
  for (const lang of LANGS) {
    const url = `https://healthdesk.site/${lang}/`;
    const kws = keywords.filter(k => k.targetPage === `${lang}/landing`);
    pages.push({
      type: 'landing',
      lang,
      url,
      title: `Landing ${lang.toUpperCase()}`,
      keyword: kws.length ? kws[0].keyword : null,
      allKeywords: kws.map(k => k.keyword),
      position: kws.length && kws[0].history.length ? kws[0].history[kws[0].history.length - 1].position : null
    });
  }

  // Blog posts
  if (fs.existsSync(BLOG_DIR)) {
    const langs = fs.readdirSync(BLOG_DIR).filter(d => fs.statSync(path.join(BLOG_DIR, d)).isDirectory());
    for (const lang of langs) {
      const langDir = path.join(BLOG_DIR, lang);
      const files = fs.readdirSync(langDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(langDir, file), 'utf8');
        const parsed = fm(content);
        const slug = parsed.attributes.slug || file.replace('.md', '');
        const url = `https://healthdesk.site/${lang}/blog/${slug}`;
        const kw = keywords.find(k => k.targetPage === `${lang}/blog/${slug}`);
        const status = (studio.articles[`${lang}/${slug}`] && studio.articles[`${lang}/${slug}`].status) || 'draft';
        pages.push({
          type: 'blog',
          lang,
          url,
          title: parsed.attributes.title,
          slug,
          keyword: parsed.attributes.keyword || null,
          position: kw && kw.history.length ? kw.history[kw.history.length - 1].position : null,
          date: parsed.attributes.date,
          status,
          siblings: parsed.attributes.siblings || {}
        });
      }
    }
  }

  res.json(pages);
});

// API: Check positions for all tracked keywords (or one)
app.post('/api/keywords/check-positions', async (req, res) => {
  const { keywordId } = req.body; // optional: check single keyword
  const studio = loadStudioData();
  if (!studio.tracked_keywords || !studio.tracked_keywords.length) {
    return res.json({ checked: 0, results: [] });
  }

  const toCheck = keywordId
    ? studio.tracked_keywords.filter(k => k.id === keywordId)
    : studio.tracked_keywords;

  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  for (const kw of toCheck) {
    const locale = LANG_MAP[kw.lang] || LANG_MAP.en;

    try {
      console.log(`[Rank] Checking "${kw.keyword}" (${kw.lang})...`);
      const data = await serperRequest('search', {
        q: kw.keyword,
        gl: locale.gl,
        hl: locale.hl,
        num: 100
      });

      // Find healthdesk.site in results
      const organic = data.organic || [];
      let foundPosition = null;
      let foundUrl = null;
      const allMatches = [];

      for (const result of organic) {
        if (result.link && result.link.includes('healthdesk.site')) {
          if (!foundPosition) {
            foundPosition = result.position;
            foundUrl = result.link.replace('https://healthdesk.site', '');
          }
          allMatches.push({
            position: result.position,
            url: result.link.replace('https://healthdesk.site', ''),
            title: result.title
          });
        }
      }

      // Detect cannibalization
      const cannibalization = allMatches.length > 1 ||
        (foundUrl && kw.targetUrl && foundUrl !== kw.targetUrl);

      // Store in history
      const entry = {
        date: today,
        position: foundPosition,
        foundUrl,
        allMatches,
        cannibalization
      };

      // Find keyword in studio data and update
      const kwRef = studio.tracked_keywords.find(k => k.id === kw.id);
      if (kwRef) {
        // Replace today's entry if already checked today
        const todayIdx = kwRef.history.findIndex(h => h.date === today);
        if (todayIdx >= 0) {
          kwRef.history[todayIdx] = entry;
        } else {
          kwRef.history.push(entry);
        }
        // Keep max 52 weeks of history
        if (kwRef.history.length > 52) kwRef.history = kwRef.history.slice(-52);
      }

      results.push({ id: kw.id, keyword: kw.keyword, ...entry });
      console.log(`[Rank] "${kw.keyword}": position ${foundPosition || 'not found'}${cannibalization ? ' ⚠️ CANNIBALIZATION' : ''}`);

      // Rate limit
      if (toCheck.length > 1) await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.error(`[Rank] Error checking "${kw.keyword}": ${err.message}`);
      results.push({ id: kw.id, keyword: kw.keyword, error: err.message });
    }
  }

  saveStudioData(studio);
  res.json({ checked: results.length, results });
});

// API: Cannibalization report
app.get('/api/keywords/cannibalization', (req, res) => {
  const studio = loadStudioData();
  const keywords = studio.tracked_keywords || [];
  const issues = [];

  // Check for keywords where multiple pages rank
  for (const kw of keywords) {
    const latest = kw.history[kw.history.length - 1];
    if (!latest) continue;

    if (latest.cannibalization) {
      issues.push({
        keyword: kw.keyword,
        lang: kw.lang,
        targetUrl: kw.targetUrl,
        foundUrl: latest.foundUrl,
        allMatches: latest.allMatches || [],
        suggestion: latest.foundUrl !== kw.targetUrl
          ? `Strona ${latest.foundUrl} rankuje zamiast ${kw.targetUrl}. Rozważ canonical lub zmianę treści.`
          : `Kilka stron rankuje na to samo keyword. Rozważ konsolidację.`
      });
    }
  }

  // Check for overlapping target keywords across pages
  const urlKeywords = {};
  for (const kw of keywords) {
    const latest = kw.history[kw.history.length - 1];
    const url = latest?.foundUrl || kw.targetUrl;
    if (!url) continue;
    if (!urlKeywords[url]) urlKeywords[url] = [];
    urlKeywords[url].push(kw.keyword);
  }

  res.json({ issues, urlKeywords });
});

// ─── AI: Generate hero image (Gemini Nano Banana → WebP) ───
const BLOG_IMAGES_DIR = path.join(LANDING_ROOT, 'src', 'content', 'images', 'blog');

function getGeminiKey() {
  const studio = JSON.parse(fs.readFileSync(STUDIO_DATA, 'utf8'));
  return studio.gemini_api_key || process.env.GEMINI_API_KEY || null;
}

// ─── Helper: Generate hero image ───
async function doHeroImage(slug, lang, title, description, style) {
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error('No Gemini API key configured. Add gemini_api_key to studio.json');

  const langName = getLangName(lang);
  const styleHint = style || 'clean, modern, professional';

  const imagePrompt = `Generate a photorealistic hero image for a blog article.

Article: "${title}"
Description: ${description}
Style: ${styleHint}

Requirements:
- Photorealistic or high-quality illustration, landscape orientation (16:9)
- Related to workplace health, wellness, productivity, or ergonomics
- No text, no typography, no watermarks in the image
- No visible human faces (show hands, silhouettes, or objects instead)
- Good contrast, visually striking for a blog header and og:image
- Warm, inviting atmosphere with natural lighting

After generating the image, write a single line of SEO alt text (max 125 characters) in ${langName} describing what the image shows. Format: ALT: <your alt text>`;

  console.log(`[Image] Calling Gemini 3.1 Flash Image for "${title}"...`);
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    }
  );

  if (!geminiRes.ok) {
    const err = await geminiRes.json();
    throw new Error(err.error?.message || `Gemini API error: ${geminiRes.status}`);
  }

  const geminiData = await geminiRes.json();

  let imageBase64 = null;
  let imageMime = null;
  let altText = title;
  const parts = geminiData.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData) {
      imageBase64 = part.inlineData.data;
      imageMime = part.inlineData.mimeType;
    }
    if (part.text) {
      const altMatch = part.text.match(/ALT:\s*(.+)/i);
      if (altMatch) altText = altMatch[1].trim().slice(0, 125).replace(/"/g, "'");
    }
  }

  if (!imageBase64) throw new Error('Gemini did not return an image. Try again.');

  console.log(`[Image] Received ${imageMime} image, converting to WebP...`);
  const imgBuffer = Buffer.from(imageBase64, 'base64');

  fs.mkdirSync(BLOG_IMAGES_DIR, { recursive: true });
  const filename = `${slug}.webp`;
  const filepath = path.join(BLOG_IMAGES_DIR, filename);

  await sharp(imgBuffer)
    .resize(1200, 630, { fit: 'cover' })
    .webp({ quality: 82 })
    .toFile(filepath);

  const stats = fs.statSync(filepath);
  console.log(`[Image] Saved: ${filepath} (${(stats.size / 1024).toFixed(1)} KB)`);

  // Auto-save image_alt to article frontmatter
  const mdFile = findArticleFile(lang, slug);
  if (mdFile && altText) {
    const mdContent = fs.readFileSync(mdFile, 'utf8');
    const fmMatch = mdContent.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      let fmContent = fmMatch[1];
      if (fmContent.includes('image_alt:')) {
        fmContent = fmContent.replace(/image_alt:.*/, `image_alt: "${altText}"`);
      } else {
        fmContent += `\nimage_alt: "${altText}"`;
      }
      const updated = mdContent.replace(/^---\n[\s\S]*?\n---/, `---\n${fmContent}\n---`);
      fs.writeFileSync(mdFile, updated, 'utf8');
      console.log(`[Image] Saved image_alt to frontmatter: "${altText}"`);
    }
  }

  return {
    ok: true, filename,
    path: `/images/blog/${filename}`,
    altText,
    size: `${(stats.size / 1024).toFixed(1)} KB`
  };
}

app.post('/api/ai/generate-image', async (req, res) => {
  const { slug, lang, title, description, style } = req.body;
  try {
    res.json(await doHeroImage(slug, lang, title, description, style));
  } catch (err) {
    console.error('[Image]', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve blog images for preview
app.get('/api/preview-image/:filename', (req, res) => {
  const filepath = path.join(BLOG_IMAGES_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
  res.type('image/webp').sendFile(filepath);
});

// Check if hero image exists for a slug
app.get('/api/hero-image/:slug', (req, res) => {
  const filename = `${req.params.slug}.webp`;
  const filepath = path.join(BLOG_IMAGES_DIR, filename);
  if (!fs.existsSync(filepath)) return res.json({ exists: false });
  const stats = fs.statSync(filepath);
  res.json({ exists: true, filename, path: `/images/blog/${filename}`, size: `${(stats.size / 1024).toFixed(1)} KB` });
});

// Delete hero image
app.delete('/api/hero-image/:slug', (req, res) => {
  const filepath = path.join(BLOG_IMAGES_DIR, `${req.params.slug}.webp`);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  res.json({ ok: true });
});

// ─── GSC Indexing ───
const GSC_KEY_PATH = path.join(LANDING_ROOT, 'gsc-key.json');
const GSC_CACHE_PATH = path.join(LANDING_ROOT, '.gsc-cache.json');
const SITEMAP_PATH_GSC = path.join(DIST_DIR, 'sitemap.xml');
const SITE_URL_GSC = 'sc-domain:healthdesk.site';

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

// ─── GSC Search Analytics ───

function getGscAuth() {
  const { google } = require('googleapis');
  return new google.auth.GoogleAuth({
    keyFile: GSC_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
  });
}

// API: GSC Analytics — performance data (queries, pages, clicks, impressions, position)
app.get('/api/gsc/analytics', async (req, res) => {
  if (!fs.existsSync(GSC_KEY_PATH)) return res.json({ configured: false, error: 'Brak gsc-key.json' });

  const { days = 28, type = 'query' } = req.query; // type: query | page
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  try {
    const { google } = require('googleapis');
    const auth = getGscAuth();
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    const result = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL_GSC,
      requestBody: {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        dimensions: [type],
        rowLimit: 100
      }
    });

    const rows = (result.data.rows || []).map(r => ({
      key: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Math.round(r.ctr * 1000) / 10,
      position: Math.round(r.position * 10) / 10
    }));

    res.json({ configured: true, rows, period: `${startDate.toISOString().slice(0, 10)} — ${endDate.toISOString().slice(0, 10)}` });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[GSC Analytics]', msg);
    res.json({ configured: true, rows: [], error: msg });
  }
});

// API: GSC Analytics — daily trend for specific query or page
app.get('/api/gsc/analytics/trend', async (req, res) => {
  if (!fs.existsSync(GSC_KEY_PATH)) return res.json({ configured: false });

  const { days = 28, query, page } = req.query;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  const filters = [];
  if (query) filters.push({ dimension: 'query', operator: 'equals', expression: query });
  if (page) filters.push({ dimension: 'page', operator: 'contains', expression: page });

  try {
    const { google } = require('googleapis');
    const auth = getGscAuth();
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    const result = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL_GSC,
      requestBody: {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        dimensions: ['date'],
        dimensionFilterGroups: filters.length ? [{ filters }] : undefined,
        rowLimit: 500
      }
    });

    const rows = (result.data.rows || []).map(r => ({
      date: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Math.round(r.ctr * 1000) / 10,
      position: Math.round(r.position * 10) / 10
    }));

    res.json({ configured: true, rows });
  } catch (err) {
    res.json({ configured: true, rows: [], error: err.response?.data?.error?.message || err.message });
  }
});

// API: GSC Analytics — discover new keywords not yet tracked
app.get('/api/gsc/discover-keywords', async (req, res) => {
  if (!fs.existsSync(GSC_KEY_PATH)) return res.json({ configured: false });

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 28);

  try {
    const { google } = require('googleapis');
    const auth = getGscAuth();
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    const result = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL_GSC,
      requestBody: {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        dimensions: ['query', 'page'],
        rowLimit: 200
      }
    });

    const studio = loadStudioData();
    const tracked = (studio.tracked_keywords || []).map(k => k.keyword.toLowerCase());

    const discovered = (result.data.rows || [])
      .filter(r => !tracked.includes(r.keys[0].toLowerCase()))
      .map(r => ({
        query: r.keys[0],
        page: r.keys[1],
        clicks: r.clicks,
        impressions: r.impressions,
        position: Math.round(r.position * 10) / 10
      }))
      .sort((a, b) => b.impressions - a.impressions);

    res.json({ configured: true, discovered });
  } catch (err) {
    res.json({ configured: true, discovered: [], error: err.response?.data?.error?.message || err.message });
  }
});

// ─── Autopilot: progress tracking ───
let autopilotProgress = null;
// { status, currentStep, totalSteps, stepName, currentTopic, totalTopics, completedTopics, results[], error }

app.get('/api/ai/autopilot/status', (req, res) => {
  res.json(autopilotProgress || { status: 'idle' });
});

// ─── Helper: slugify for autopilot ───
function autoSlugify(text) {
  let slug = text.toLowerCase()
    .replace(/[ąà]/g,'a').replace(/[ćč]/g,'c').replace(/[ę]/g,'e')
    .replace(/[łĺ]/g,'l').replace(/[ńñ]/g,'n').replace(/[óò]/g,'o')
    .replace(/[śš]/g,'s').replace(/[źżž]/g,'z').replace(/[üú]/g,'u')
    .replace(/[ö]/g,'o').replace(/[ä]/g,'a').replace(/[ß]/g,'ss')
    .replace(/[èéêë]/g,'e').replace(/[ìíîï]/g,'i').replace(/[ùûü]/g,'u')
    // Cyrillic transliteration
    .replace(/[а]/g,'a').replace(/[б]/g,'b').replace(/[в]/g,'v').replace(/[г]/g,'g')
    .replace(/[д]/g,'d').replace(/[е]/g,'e').replace(/[ж]/g,'zh').replace(/[з]/g,'z')
    .replace(/[и]/g,'i').replace(/[й]/g,'y').replace(/[к]/g,'k').replace(/[л]/g,'l')
    .replace(/[м]/g,'m').replace(/[н]/g,'n').replace(/[о]/g,'o').replace(/[п]/g,'p')
    .replace(/[р]/g,'r').replace(/[с]/g,'s').replace(/[т]/g,'t').replace(/[у]/g,'u')
    .replace(/[ф]/g,'f').replace(/[х]/g,'kh').replace(/[ц]/g,'ts').replace(/[ч]/g,'ch')
    .replace(/[ш]/g,'sh').replace(/[щ]/g,'sch').replace(/[ъь]/g,'').replace(/[ы]/g,'y')
    .replace(/[э]/g,'e').replace(/[ю]/g,'yu').replace(/[я]/g,'ya').replace(/[ё]/g,'yo')
    // Turkish special chars
    .replace(/[ğ]/g,'g').replace(/[ı]/g,'i').replace(/[ş]/g,'s').replace(/[ç]/g,'c')
    .replace(/[^a-z0-9\u3000-\u9fff\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  // For CJK-only slugs (ja, zh, ko), if no latin chars, use a hash-based slug
  if (!slug.match(/[a-z]/)) {
    const hash = text.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    slug = 'article-' + Math.abs(hash).toString(36);
  }
  return slug;
}

// ─── Autopilot: single topic pipeline ───
async function runAutopilot(lang, topic, persona) {
  const steps = [];
  const updateStep = (num, name, status) => {
    steps[num - 1] = { step: num, name, status, startedAt: Date.now() };
    if (autopilotProgress) {
      autopilotProgress.currentStep = num;
      autopilotProgress.stepName = name;
      autopilotProgress.steps = steps;
    }
  };

  try {
    // Step 1: Keyword Research
    updateStep(1, 'Keyword Research', 'running');
    const serp = await doKeywordSearch(topic, lang);
    steps[0].status = 'done';

    // Step 2: Keyword Analysis
    updateStep(2, 'Keyword Analysis', 'running');
    const analysis = await doKeywordAnalyze(topic, lang, serp);
    steps[1].status = 'done';

    // Step 3: AI Outline
    updateStep(3, 'AI Outline', 'running');
    const outline = await doOutline(analysis.suggestedTitle || topic, lang);
    steps[2].status = 'done';

    const title = outline.title || analysis.suggestedTitle || topic;
    const slug = autoSlugify(title);
    const description = outline.description || '';

    // Step 4: Create Article
    updateStep(4, 'Create Article', 'running');
    const langDir = path.join(BLOG_DIR, lang);
    fs.mkdirSync(langDir, { recursive: true });
    const filePath = path.join(langDir, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
      const content = `---\ntitle: "${title.replace(/"/g, '\\"')}"\nslug: "${slug}"\ndate: ${new Date().toISOString().split('T')[0]}\ndescription: "${description.replace(/"/g, '\\"')}"\nkeyword: "${topic.replace(/"/g, '\\"')}"\ntags: [${(outline.tags || []).map(t => `"${t}"`).join(', ')}]\nlang: ${lang}\n---\n\n`;
      fs.writeFileSync(filePath, content, 'utf8');
    }
    const studio = loadStudioData();
    studio.articles[`${lang}/${slug}`] = { status: 'draft' };
    saveStudioData(studio);
    steps[3].status = 'done';

    // Step 5: AI Draft
    updateStep(5, 'AI Draft', 'running');
    const draftResult = await doDraft(title, description, outline.outline || [], lang, topic, slug, persona);
    const markdown = draftResult.markdown;
    steps[4].status = 'done';

    // Step 6: AI Audit
    updateStep(6, 'AI Audit', 'running');
    const audit = await doAudit(markdown, lang);
    const aiScore = audit.score || 0;
    steps[5].status = 'done';
    steps[5].detail = `Score: ${aiScore}/10`;

    let currentMarkdown = markdown;
    let finalAiScore = aiScore;

    // Steps 7-8: Humanize + Grammar with iteration (max 2 rounds)
    const MAX_ROUNDS = 2;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const roundLabel = MAX_ROUNDS > 1 ? ` (${round}/${MAX_ROUNDS})` : '';

      // Step 7: Humanize (if score > 5)
      updateStep(7, `Humanize${roundLabel}`, finalAiScore > 5 ? 'running' : 'skipped');
      if (finalAiScore > 5) {
        const humanized = await doHumanize(currentMarkdown, lang);
        currentMarkdown = humanized.articleText || humanized.markdown;
        steps[6].status = 'done';
      }

      // Step 8: Grammar Fix
      updateStep(8, `Grammar Fix${roundLabel}`, 'running');
      const grammarResult = await doGrammarFix(currentMarkdown, lang);
      if (grammarResult.changed) currentMarkdown = grammarResult.markdown;
      steps[7].status = 'done';
      steps[7].detail = `${grammarResult.issueCount} issues`;

      // Re-audit after corrections to check improvement
      if (round < MAX_ROUNDS && finalAiScore > 5) {
        updateStep(6, `Re-audit${roundLabel}`, 'running');
        const reAudit = await doAudit(currentMarkdown, lang);
        finalAiScore = reAudit.score || 0;
        steps[5].status = 'done';
        steps[5].detail = `Score: ${finalAiScore}/10`;
        console.log(`[Autopilot] Round ${round} re-audit: ${finalAiScore}/10`);
        if (finalAiScore <= 5) {
          console.log(`[Autopilot] Score OK after round ${round}, skipping further rounds`);
          break;
        }
      } else {
        break;
      }
    }

    // Step 9: AI Description
    updateStep(9, 'AI Description', 'running');
    const metaDescription = await doDescription(currentMarkdown, title, lang);
    steps[8].status = 'done';

    // Step 10: Hero Image
    updateStep(10, 'Hero Image', 'running');
    let heroResult = null;
    try {
      heroResult = await doHeroImage(slug, lang, title, metaDescription);
      steps[9].status = 'done';
    } catch (imgErr) {
      console.error(`[Autopilot] Hero image failed: ${imgErr.message}`);
      steps[9].status = 'error';
      steps[9].detail = imgErr.message;
    }

    // Step 11: Save final article
    updateStep(11, 'Save Article', 'running');
    const finalFrontmatter = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `slug: "${slug}"`,
      `date: ${new Date().toISOString().split('T')[0]}`,
      `description: "${metaDescription.replace(/"/g, '\\"')}"`,
      `keyword: "${topic.replace(/"/g, '\\"')}"`,
      `tags: [${(outline.tags || []).map(t => `"${t}"`).join(', ')}]`,
      `lang: ${lang}`,
      heroResult?.altText ? `image_alt: "${heroResult.altText}"` : null,
      draftResult.faqYaml || null,
      '---'
    ].filter(Boolean).join('\n');

    fs.writeFileSync(filePath, finalFrontmatter + '\n' + currentMarkdown, 'utf8');
    syncArticleKeyword(lang, slug, topic);
    steps[10].status = 'done';

    const wordCount = currentMarkdown.split(/\s+/).filter(Boolean).length;
    return {
      slug, lang, title, score: finalAiScore, wordCount,
      description: metaDescription, steps,
      heroImage: heroResult ? heroResult.filename : null
    };

  } catch (err) {
    const failedStep = steps.findIndex(s => s && s.status === 'running');
    if (failedStep >= 0) steps[failedStep].status = 'error';
    throw err;
  }
}

// ─── API: Autopilot single ───
app.post('/api/ai/autopilot', async (req, res) => {
  const { lang, topic, persona } = req.body;
  if (!lang || !topic) return res.status(400).json({ error: 'lang and topic required' });

  autopilotProgress = {
    status: 'running', currentStep: 0, totalSteps: 11, stepName: 'Starting...',
    currentTopic: topic, totalTopics: 1, completedTopics: 0, results: []
  };

  try {
    const result = await runAutopilot(lang, topic, persona);
    autopilotProgress.status = 'done';
    autopilotProgress.completedTopics = 1;
    autopilotProgress.results = [result];
    res.json(result);
    setTimeout(() => { if (autopilotProgress?.status === 'done') autopilotProgress = null; }, 60000);
  } catch (err) {
    console.error('[Autopilot] Error:', err.message);
    autopilotProgress.status = 'error';
    autopilotProgress.error = err.message;
    res.status(500).json({ error: err.message });
    setTimeout(() => { autopilotProgress = null; }, 60000);
  }
});

// ─── API: Autopilot batch ───
app.post('/api/ai/autopilot/batch', async (req, res) => {
  const { lang, topics, persona } = req.body;
  // topics can be strings (same lang) or objects {lang, topic, persona?}
  if (!topics || !topics.length) return res.status(400).json({ error: 'topics[] required' });
  if (!lang && typeof topics[0] === 'string') return res.status(400).json({ error: 'lang required when topics are strings' });

  const normalized = topics.map(t => typeof t === 'string' ? { lang, topic: t.trim(), persona } : { lang: t.lang, topic: t.topic?.trim(), persona: t.persona || persona });

  autopilotProgress = {
    status: 'running', currentStep: 0, totalSteps: 11, stepName: 'Starting...',
    currentTopic: normalized[0].topic, totalTopics: normalized.length, completedTopics: 0, results: []
  };

  const results = [];
  for (let i = 0; i < normalized.length; i++) {
    const { lang: itemLang, topic, persona: itemPersona } = normalized[i];
    if (!topic || !itemLang) continue;

    autopilotProgress.currentTopic = `[${itemLang}] ${topic}`;
    autopilotProgress.completedTopics = i;
    autopilotProgress.currentStep = 0;

    try {
      const result = await runAutopilot(itemLang, topic, itemPersona);
      results.push(result);
      autopilotProgress.results = results;
    } catch (err) {
      console.error(`[Autopilot Batch] Error on "${topic}":`, err.message);
      results.push({ lang: itemLang, topic, error: err.message, steps: autopilotProgress.steps || [] });
      autopilotProgress.results = results;
    }
  }

  autopilotProgress.status = 'done';
  autopilotProgress.completedTopics = topics.length;
  res.json({ total: topics.length, completed: results.filter(r => !r.error).length, results });
  setTimeout(() => { if (autopilotProgress?.status === 'done') autopilotProgress = null; }, 60000);
});

// ═══════════════════════════════════════════════════════════════
// ─── Content Calendar: Data helpers ───
// ═══════════════════════════════════════════════════════════════

const ALL_CALENDAR_LANGS = ['pl','en','de','es','fr','it','pt-BR','ja','zh-CN','ko','tr','ru'];

function loadCalendar() {
  const studio = loadStudioData();
  if (!studio.content_calendar) {
    studio.content_calendar = {
      interval_days: 3,
      next_run: null,
      auto_enabled: false,
      last_cluster_index: -1,
      clusters: []
    };
    saveStudioData(studio);
  }
  return studio.content_calendar;
}

function saveCalendar(cal) {
  const studio = loadStudioData();
  studio.content_calendar = cal;
  saveStudioData(studio);
}

function findNextKeyword(cal) {
  // Find first keyword with status 'scheduled' (sorted by scheduled_date)
  // If none scheduled, find first 'pending' keyword
  let best = null;
  for (const cluster of cal.clusters) {
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        if (kw.status === 'scheduled') {
          if (!best || (kw.scheduled_date && (!best.scheduled_date || kw.scheduled_date < best.scheduled_date))) {
            best = { ...kw, lang, cluster_id: cluster.id };
          }
        }
      }
    }
  }
  if (best) return best;
  // Fallback: first pending
  for (const cluster of cal.clusters) {
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        if (kw.status === 'pending') {
          return { ...kw, lang, cluster_id: cluster.id };
        }
      }
    }
  }
  return null;
}

function findNextBatch(cal) {
  // Cluster rotation: each run picks keywords from ONE cluster, then rotates
  // to the next cluster on the following run (1→2→3→4→5→1→...)
  const today = new Date().toISOString().split('T')[0];
  const skipLangs = new Set();

  if (!cal.clusters || cal.clusters.length === 0) return [];

  // Determine which cluster to use (round-robin)
  const clusterCount = cal.clusters.length;
  const lastIdx = typeof cal.last_cluster_index === 'number' ? cal.last_cluster_index : -1;
  const currentIdx = (lastIdx + 1) % clusterCount;
  const activeCluster = cal.clusters[currentIdx];

  console.log(`[Calendar] Rotation: cluster ${currentIdx + 1}/${clusterCount} — "${activeCluster.name}"`);

  // Find languages already published/writing today
  for (const cluster of cal.clusters) {
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        if (kw.status === 'writing') skipLangs.add(lang);
        if (kw.status === 'published' && kw.published_date === today) skipLangs.add(lang);
      }
    }
  }

  const seenLangs = new Set(skipLangs);
  const batch = [];

  // First pass: scheduled keywords from active cluster (earliest date first)
  const scheduled = [];
  for (const lang of Object.keys(activeCluster.keywords || {})) {
    if (seenLangs.has(lang)) continue;
    for (const kw of activeCluster.keywords[lang]) {
      if (kw.status === 'scheduled') {
        scheduled.push({ ...kw, lang, cluster_id: activeCluster.id });
      }
    }
  }
  scheduled.sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''));
  for (const kw of scheduled) {
    if (!seenLangs.has(kw.lang)) {
      seenLangs.add(kw.lang);
      batch.push(kw);
    }
  }

  // Second pass: pending keywords from active cluster for missing langs
  for (const lang of Object.keys(activeCluster.keywords || {})) {
    if (seenLangs.has(lang)) continue;
    for (const kw of activeCluster.keywords[lang]) {
      if (kw.status === 'pending') {
        seenLangs.add(lang);
        batch.push({ ...kw, lang, cluster_id: activeCluster.id });
        break;
      }
    }
  }

  // Save rotation index so next run picks the next cluster
  cal.last_cluster_index = currentIdx;

  if (skipLangs.size > 0) {
    console.log(`[Calendar] Skipping langs (already done today): ${[...skipLangs].join(', ')}`);
  }

  if (batch.length === 0) {
    // Active cluster exhausted — try next cluster
    console.log(`[Calendar] Cluster "${activeCluster.name}" has no pending/scheduled keywords, trying next...`);
    cal.last_cluster_index = currentIdx; // skip this one
    return findNextBatch(cal);
  }

  return batch;
}

function updateKeywordStatus(cal, lang, keyword, updates) {
  for (const cluster of cal.clusters) {
    const kwList = cluster.keywords[lang];
    if (!kwList) continue;
    const kw = kwList.find(k => k.keyword === keyword);
    if (kw) {
      Object.assign(kw, updates);
      return true;
    }
  }
  return false;
}

// ─── Content Calendar: CRUD endpoints ───

app.get('/api/calendar', (req, res) => {
  const cal = loadCalendar();
  // Add summary stats
  let totalPending = 0, totalScheduled = 0, totalWriting = 0, totalPublished = 0, totalTracking = 0;
  for (const cluster of cal.clusters) {
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        if (kw.status === 'pending') totalPending++;
        else if (kw.status === 'scheduled') totalScheduled++;
        else if (kw.status === 'writing') totalWriting++;
        else if (kw.status === 'published') totalPublished++;
        else if (kw.status === 'tracking') totalTracking++;
      }
    }
  }
  // Rotation info
  const clusterCount = cal.clusters.length;
  const lastIdx = typeof cal.last_cluster_index === 'number' ? cal.last_cluster_index : -1;
  const nextClusterIdx = clusterCount > 0 ? (lastIdx + 1) % clusterCount : 0;
  const nextClusterName = clusterCount > 0 ? cal.clusters[nextClusterIdx].name : null;

  res.json({ ...cal, stats: { pending: totalPending, scheduled: totalScheduled, writing: totalWriting, published: totalPublished, tracking: totalTracking }, rotation: { next_cluster_index: nextClusterIdx, next_cluster_name: nextClusterName, cluster_count: clusterCount } });
});

app.post('/api/calendar/cluster', (req, res) => {
  const { name, keywords } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const cal = loadCalendar();
  const cluster = {
    id: Date.now().toString(36),
    name,
    created: new Date().toISOString().split('T')[0],
    keywords: keywords || {}
  };
  cal.clusters.push(cluster);
  saveCalendar(cal);
  res.json(cluster);
});

app.put('/api/calendar/cluster/:id', (req, res) => {
  const cal = loadCalendar();
  const cluster = cal.clusters.find(c => c.id === req.params.id);
  if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
  if (req.body.name) cluster.name = req.body.name;
  if (req.body.keywords) cluster.keywords = req.body.keywords;
  saveCalendar(cal);
  res.json(cluster);
});

app.delete('/api/calendar/cluster/:id', (req, res) => {
  const cal = loadCalendar();
  cal.clusters = cal.clusters.filter(c => c.id !== req.params.id);
  saveCalendar(cal);
  res.json({ ok: true });
});

// ─── Content Calendar: Generate keywords (Claude) ───

app.post('/api/calendar/generate-keywords', async (req, res) => {
  const { cluster_id, cluster_name, langs, count } = req.body;
  const targetLangs = langs || ALL_CALENDAR_LANGS;
  const kwCount = count || 10;

  try {
    const prompt = `Generate ${kwCount} long-tail SEO keywords for EACH of the following languages: ${targetLangs.join(', ')}.

Topic cluster: "${cluster_name}"
Context: HealthDesk is a desktop wellness app for office workers — break reminders, eye exercises, stretch exercises, water intake tracking, posture tips, ergonomics.

For each language, generate keywords that:
1. Are natural search queries in that language (NOT translations of English keywords)
2. Target informational intent (how-to, tips, guides)
3. Are long-tail (4-8 words) for lower competition
4. Are relevant to the cluster topic and HealthDesk's niche

Return JSON:
{
  "keywords": {
    "pl": ["keyword1", "keyword2", ...],
    "en": ["keyword1", "keyword2", ...],
    ...
  }
}`;

    const result = await callClaude(
      'You are an SEO keyword researcher specializing in health, wellness, and productivity content across multiple languages. Generate native, natural keywords — NOT translations.',
      prompt,
      4000
    );
    const parsed = parseJsonResponse(result);

    // Build keyword objects
    const keywordsMap = {};
    for (const lang of targetLangs) {
      const kwList = parsed.keywords?.[lang] || [];
      keywordsMap[lang] = kwList.map(kw => ({
        keyword: kw,
        intent: 'informational',
        kd: null,
        serp_verified: false,
        serp_score: null,
        status: 'pending',
        scheduled_date: null,
        slug: null,
        published_date: null,
        gsc_position: null,
        gsc_clicks: 0,
        gsc_impressions: 0,
        gsc_last_check: null
      }));
    }

    // Merge into cluster or create new
    const cal = loadCalendar();
    if (cluster_id) {
      const cluster = cal.clusters.find(c => c.id === cluster_id);
      if (cluster) {
        for (const lang of Object.keys(keywordsMap)) {
          if (!cluster.keywords[lang]) cluster.keywords[lang] = [];
          // Avoid duplicates
          const existing = new Set(cluster.keywords[lang].map(k => k.keyword.toLowerCase()));
          for (const kw of keywordsMap[lang]) {
            if (!existing.has(kw.keyword.toLowerCase())) {
              cluster.keywords[lang].push(kw);
            }
          }
        }
        saveCalendar(cal);
        res.json({ cluster_id: cluster.id, keywords: keywordsMap });
        return;
      }
    }

    // Create new cluster
    const newCluster = {
      id: Date.now().toString(36),
      name: cluster_name || 'New Cluster',
      created: new Date().toISOString().split('T')[0],
      keywords: keywordsMap
    };
    cal.clusters.push(newCluster);
    saveCalendar(cal);
    res.json({ cluster_id: newCluster.id, keywords: keywordsMap });

  } catch (err) {
    console.error('[Calendar] Generate keywords error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Content Calendar: Verify keywords (Serper SERP analysis) ───

app.post('/api/calendar/verify-keywords', async (req, res) => {
  const { cluster_id, lang, max_keywords } = req.body;
  if (!cluster_id) return res.status(400).json({ error: 'cluster_id required' });

  const cal = loadCalendar();
  const cluster = cal.clusters.find(c => c.id === cluster_id);
  if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

  const maxKw = max_keywords || 9999;
  const langsToVerify = lang ? [lang] : Object.keys(cluster.keywords);
  const results = [];

  for (const currentLang of langsToVerify) {
    const kwList = cluster.keywords[currentLang] || [];
    const unverified = kwList.filter(k => !k.serp_verified).slice(0, maxKw);

    for (const kw of unverified) {
      try {
        const locale = LANG_MAP[currentLang] || LANG_MAP.en;
        const serpData = await serperRequest('search', {
          q: kw.keyword, gl: locale.gl, hl: locale.hl, num: 10
        });

        // Analyze SERP difficulty (enhanced scoring v2)
        const organic = serpData.organic || [];
        const paa = serpData.peopleAlsoAsk || [];
        const relatedSearches = serpData.relatedSearches || [];
        const kwLower = kw.keyword.toLowerCase();

        const domains = organic.map(r => {
          try { return new URL(r.link).hostname; } catch { return ''; }
        });

        // 1. Authority domains (hard to outrank)
        const authorityDomains = ['wikipedia.org','webmd.com','healthline.com','mayoclinic.org','nhs.uk','who.int','nih.gov','clevelandclinic.org','hopkinsmedicine.org'];
        const authorityCount = domains.filter(d => authorityDomains.some(bd => d.includes(bd))).length;

        // 2. Forum/UGC domains (weak content = opportunity)
        const forumDomains = ['reddit.com','quora.com','forum','community','answers','stackexchange.com'];
        const forumCount = domains.filter(d => forumDomains.some(bd => d.includes(bd))).length;

        // 3. Exact keyword match in titles (fewer matches = easier)
        const kwWords = kwLower.split(/\s+/).filter(w => w.length > 3);
        const titleMatchScores = organic.map(r => {
          const title = (r.title || '').toLowerCase();
          const matched = kwWords.filter(w => title.includes(w)).length;
          return kwWords.length > 0 ? matched / kwWords.length : 0;
        });
        const strongTitleMatches = titleMatchScores.filter(s => s >= 0.6).length;

        // 4. Check if healthdesk.site already ranks
        const healthdeskRank = domains.findIndex(d => d.includes('healthdesk.site'));

        // 5. Total results count
        const totalResults = parseInt(serpData.searchInformation?.totalResults || '0');

        // Score: 1 (easy) to 10 (hard)
        let score = 3; // baseline

        // Authority domains push score up
        if (authorityCount >= 4) score += 3;
        else if (authorityCount >= 2) score += 2;
        else if (authorityCount >= 1) score += 1;

        // Forums in top 10 = weak competition = opportunity
        if (forumCount >= 3) score -= 2;
        else if (forumCount >= 2) score -= 1;

        // Few title matches = competitors don't target this exact phrase
        if (strongTitleMatches <= 2) score -= 1;
        else if (strongTitleMatches >= 7) score += 1;

        // Total results volume
        if (totalResults > 10000000) score += 2;
        else if (totalResults > 1000000) score += 1;

        // Thin SERP = opportunity
        if (organic.length < 5) score -= 2;

        // PAA present = featured snippet opportunity (bonus traffic)
        const hasPAA = paa.length > 0;

        score = Math.max(1, Math.min(10, score));

        kw.serp_verified = true;
        kw.serp_score = score;
        kw.kd = score <= 3 ? 'low' : score <= 6 ? 'medium' : 'high';

        // Store extra SERP intel
        kw.serp_details = {
          authority_domains: authorityCount,
          forum_domains: forumCount,
          title_matches: strongTitleMatches,
          has_paa: hasPAA,
          paa_count: paa.length,
          related_searches: relatedSearches.length,
          total_results: totalResults,
          healthdesk_rank: healthdeskRank >= 0 ? healthdeskRank + 1 : null
        };

        results.push({ lang: currentLang, keyword: kw.keyword, score, kd: kw.kd, details: kw.serp_details });

        // Rate limit Serper
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        results.push({ lang: currentLang, keyword: kw.keyword, error: err.message });
      }
    }
  }

  saveCalendar(cal);
  res.json({ verified: results.length, results });
});

// ─── Content Calendar: Reset SERP verification ───

app.post('/api/calendar/reset-verify', (req, res) => {
  const cal = loadCalendar();
  let resetCount = 0;
  for (const cluster of cal.clusters) {
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        if (kw.serp_verified) {
          kw.serp_verified = false;
          kw.serp_score = null;
          kw.kd = null;
          delete kw.serp_details;
          resetCount++;
        }
      }
    }
  }
  saveCalendar(cal);
  console.log(`[Calendar] Reset SERP verification for ${resetCount} keywords`);
  res.json({ reset: resetCount });
});

// ─── Content Calendar: Settings ───

app.post('/api/calendar/settings', (req, res) => {
  const { interval_days } = req.body;
  const cal = loadCalendar();
  if (interval_days !== undefined) cal.interval_days = parseInt(interval_days) || 3;
  saveCalendar(cal);
  res.json({ ok: true, interval_days: cal.interval_days });
});

app.post('/api/calendar/auto-toggle', (req, res) => {
  const { enabled } = req.body;
  const cal = loadCalendar();
  cal.auto_enabled = !!enabled;
  if (cal.auto_enabled && !cal.next_run) {
    const next = new Date();
    next.setDate(next.getDate() + (cal.interval_days || 3));
    cal.next_run = next.toISOString();
  }
  saveCalendar(cal);
  console.log(`[Calendar] Auto-publish ${cal.auto_enabled ? 'ENABLED' : 'DISABLED'}, next: ${cal.next_run}`);
  res.json({ ok: true, auto_enabled: cal.auto_enabled, next_run: cal.next_run });
});

// ─── Content Calendar: Run next keyword in queue ───

let calendarProgress = null;

app.get('/api/calendar/status', (req, res) => {
  res.json(calendarProgress || { status: 'idle' });
});

app.post('/api/calendar/run-next', async (req, res) => {
  if (calendarProgress && calendarProgress.status === 'running') {
    return res.status(409).json({ error: 'Pipeline already running' });
  }

  const cal = loadCalendar();
  const batch = findNextBatch(cal);
  if (batch.length === 0) return res.status(404).json({ error: 'No keywords in queue' });

  calendarProgress = {
    status: 'running',
    batch_total: batch.length,
    batch_done: 0,
    keyword: batch[0].keyword,
    lang: batch[0].lang,
    step: 'autopilot',
    results: [],
    started: new Date().toISOString()
  };

  // Mark all batch keywords as writing
  for (const kw of batch) {
    updateKeywordStatus(cal, kw.lang, kw.keyword, { status: 'writing' });
  }
  saveCalendar(cal);

  res.json({ ok: true, batch_size: batch.length, keywords: batch.map(k => ({ lang: k.lang, keyword: k.keyword })) });

  // Run pipeline: each keyword goes through FULL cycle before next one
  // autopilot → build → deploy → GSC → next keyword
  let completed = 0;

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    const label = `[${i + 1}/${batch.length}] [${item.lang}]`;
    calendarProgress.batch_done = i;
    calendarProgress.keyword = item.keyword;
    calendarProgress.lang = item.lang;

    try {
      // Step 1: Write article
      calendarProgress.step = `writing (${i + 1}/${batch.length})`;
      console.log(`${label} Autopilot: ${item.keyword}`);
      const result = await runAutopilot(item.lang, item.keyword);
      const slug = result.slug;

      // Step 2: Build
      calendarProgress.step = `build (${i + 1}/${batch.length})`;
      console.log(`${label} Building...`);
      execSync('node build.js', { cwd: LANDING_ROOT, timeout: 60000 });

      // Step 3: Deploy to FTP
      calendarProgress.step = `deploy (${i + 1}/${batch.length})`;
      console.log(`${label} Deploying...`);
      await new Promise((resolve, reject) => {
        exec('node deploy.js', { cwd: LANDING_ROOT, timeout: 120000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
      });

      // Step 4: GSC submit
      calendarProgress.step = `gsc (${i + 1}/${batch.length})`;
      const articleUrl = `https://healthdesk.site/${item.lang}/blog/${slug}/`;
      if (fs.existsSync(GSC_KEY_PATH)) {
        try {
          const { google } = require('googleapis');
          const auth = new google.auth.GoogleAuth({ keyFile: GSC_KEY_PATH, scopes: ['https://www.googleapis.com/auth/indexing'] });
          const indexing = google.indexing({ version: 'v3', auth });
          await indexing.urlNotifications.publish({ requestBody: { url: articleUrl, type: 'URL_UPDATED' } });
          console.log(`${label} GSC submitted: ${articleUrl}`);
        } catch (gscErr) {
          console.error(`${label} GSC failed: ${gscErr.message}`);
        }
      }

      // Update statuses
      const cal2 = loadCalendar();
      updateKeywordStatus(cal2, item.lang, item.keyword, {
        status: 'published', slug, published_date: new Date().toISOString().split('T')[0]
      });
      saveCalendar(cal2);

      const studio = loadStudioData();
      studio.articles[`${item.lang}/${slug}`] = { status: 'published' };
      saveStudioData(studio);

      calendarProgress.results.push({ lang: item.lang, slug, status: 'ok' });
      completed++;
      console.log(`${label} DONE — ${slug} is LIVE (${completed}/${batch.length})`);

    } catch (err) {
      console.error(`${label} Error: ${err.message}`);
      calendarProgress.results.push({ lang: item.lang, keyword: item.keyword, status: 'error', error: err.message });

      const cal2 = loadCalendar();
      updateKeywordStatus(cal2, item.lang, item.keyword, { status: 'scheduled' });
      saveCalendar(cal2);
    }
  }

  // Schedule next run
  const cal3 = loadCalendar();
  if (cal3.auto_enabled) {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + (cal3.interval_days || 3));
    cal3.next_run = nextDate.toISOString();
    saveCalendar(cal3);
  }

  calendarProgress.status = 'done';
  calendarProgress.batch_done = batch.length;
  console.log(`[Calendar] Batch complete: ${completed}/${batch.length} articles published`);

  setTimeout(() => {
    if (calendarProgress && calendarProgress.status !== 'running') calendarProgress = null;
  }, 120000);
});

// ─── Content Calendar: Stats ───

app.get('/api/calendar/stats', (req, res) => {
  const cal = loadCalendar();
  let total = 0, published = 0, avgPosition = 0, posCount = 0, totalClicks = 0, totalImpressions = 0;
  for (const cluster of cal.clusters) {
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        total++;
        if (kw.status === 'published' || kw.status === 'tracking') published++;
        if (kw.gsc_position) { avgPosition += kw.gsc_position; posCount++; }
        totalClicks += kw.gsc_clicks || 0;
        totalImpressions += kw.gsc_impressions || 0;
      }
    }
  }
  res.json({
    total, published,
    avg_position: posCount ? Math.round(avgPosition / posCount * 10) / 10 : null,
    total_clicks: totalClicks,
    total_impressions: totalImpressions
  });
});

// ─── Content Calendar: Refresh GSC positions ───

app.post('/api/calendar/refresh-gsc', async (req, res) => {
  if (!fs.existsSync(GSC_KEY_PATH)) return res.json({ error: 'No GSC key configured' });

  try {
    const { google } = require('googleapis');
    const auth = getGscAuth();
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 28);

    const result = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL_GSC,
      requestBody: {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        dimensions: ['query', 'page'],
        rowLimit: 1000
      }
    });

    const rows = result.data.rows || [];
    const cal = loadCalendar();
    let updated = 0;

    for (const cluster of cal.clusters) {
      for (const lang of Object.keys(cluster.keywords || {})) {
        for (const kw of cluster.keywords[lang]) {
          if (kw.status !== 'published' && kw.status !== 'tracking') continue;

          // Match by keyword in GSC queries
          const match = rows.find(r =>
            r.keys[0].toLowerCase().includes(kw.keyword.toLowerCase().substring(0, 20)) ||
            (kw.slug && r.keys[1].includes(kw.slug))
          );

          if (match) {
            kw.gsc_position = Math.round(match.position * 10) / 10;
            kw.gsc_clicks = match.clicks;
            kw.gsc_impressions = match.impressions;
            kw.gsc_last_check = new Date().toISOString();
            if (kw.status === 'published') kw.status = 'tracking';
            updated++;
          }
        }
      }
    }

    saveCalendar(cal);
    res.json({ updated, total_gsc_rows: rows.length });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Content Calendar: Auto-refresh underperforming articles ───

app.post('/api/calendar/auto-refresh', async (req, res) => {
  const cal = loadCalendar();
  const candidates = [];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  for (const cluster of cal.clusters) {
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        if (kw.status !== 'tracking' && kw.status !== 'published') continue;
        if (!kw.published_date) continue;
        if (new Date(kw.published_date) > thirtyDaysAgo) continue; // too new

        const underperforming =
          !kw.gsc_position || kw.gsc_position > 40 ||
          (kw.gsc_impressions < 5 && kw.gsc_position > 20);

        if (underperforming) {
          candidates.push({ ...kw, lang, cluster_id: cluster.id });
        }
      }
    }
  }

  if (candidates.length === 0) return res.json({ refreshed: 0, message: 'No underperforming articles found' });

  // Pick the worst performer
  const target = candidates.sort((a, b) => (b.gsc_position || 100) - (a.gsc_position || 100))[0];

  try {
    console.log(`[Calendar Refresh] Refreshing: [${target.lang}] ${target.keyword} (pos: ${target.gsc_position})`);

    // Read existing article
    const filePath = findArticleFile(target.lang, target.slug);
    if (!filePath) return res.status(404).json({ error: 'Article file not found' });

    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = fm(content);

    // Ask AI to improve
    const improveResult = await callClaude(
      `You are an SEO content optimization expert for ${getLangName(target.lang)} content.`,
      `This article targets the keyword "${target.keyword}" but is underperforming (position: ${target.gsc_position || 'not ranked'}, impressions: ${target.gsc_impressions || 0}).

Current article:
${parsed.body}

Improve this article to rank better:
1. Strengthen keyword usage (naturally, not stuffing)
2. Add more detailed, actionable content (expand by 20-30%)
3. Improve headings for better search intent match
4. Add new relevant sections if helpful
5. Keep the same structure and style

Return ONLY the improved markdown body (no frontmatter).`,
      6000
    );

    // Save improved version
    const updatedDate = new Date().toISOString().split('T')[0];
    const frontmatterStr = content.split('---').slice(0, 2).join('---') + '---';
    const updatedFm = frontmatterStr.replace(/date: .+/, `date: ${updatedDate}`);
    fs.writeFileSync(filePath, updatedFm + '\n' + improveResult, 'utf8');

    // Update keyword status
    updateKeywordStatus(cal, target.lang, target.keyword, {
      status: 'published', // will go back to tracking after next GSC refresh
      published_date: updatedDate
    });
    saveCalendar(cal);

    // Rebuild + redeploy
    execSync('node build.js', { cwd: LANDING_ROOT, timeout: 60000 });
    await new Promise((resolve, reject) => {
      exec('node deploy.js', { cwd: LANDING_ROOT, timeout: 120000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message)); else resolve(stdout);
      });
    });

    // GSC re-submit
    if (fs.existsSync(GSC_KEY_PATH)) {
      try {
        const { google } = require('googleapis');
        const auth = new google.auth.GoogleAuth({ keyFile: GSC_KEY_PATH, scopes: ['https://www.googleapis.com/auth/indexing'] });
        const indexing = google.indexing({ version: 'v3', auth });
        const url = `https://healthdesk.site/${target.lang}/blog/${target.slug}/`;
        await indexing.urlNotifications.publish({ requestBody: { url, type: 'URL_UPDATED' } });
      } catch (e) { console.error('[Calendar Refresh] GSC re-submit failed:', e.message); }
    }

    res.json({ refreshed: 1, keyword: target.keyword, lang: target.lang, slug: target.slug });

  } catch (err) {
    console.error('[Calendar Refresh] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Content Calendar: Schedule keywords ───

app.post('/api/calendar/schedule', (req, res) => {
  const { cluster_id, lang, count } = req.body;
  const cal = loadCalendar();
  const intervalDays = cal.interval_days || 3;

  // Collect pending keywords PER CLUSTER, per language, sorted by KD (low first)
  const pendingPerCluster = [];
  for (const cluster of cal.clusters) {
    if (cluster_id && cluster.id !== cluster_id) continue;
    const byLang = {};
    const langsToProcess = lang ? [lang] : Object.keys(cluster.keywords || {});
    for (const l of langsToProcess) {
      const kwList = cluster.keywords[l] || [];
      byLang[l] = kwList
        .filter(k => k.status === 'pending' && k.serp_verified)
        .sort((a, b) => (a.serp_score || 5) - (b.serp_score || 5));
    }
    pendingPerCluster.push({ cluster, byLang });
  }

  if (pendingPerCluster.length === 0) {
    return res.json({ scheduled: 0, rounds: 0 });
  }

  // Build set of date+lang combos already published or scheduled
  const occupied = new Set();
  for (const cluster of cal.clusters) {
    for (const l of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[l]) {
        if (kw.status === 'published' && kw.published_date) occupied.add(`${kw.published_date}|${l}`);
        if (kw.status === 'scheduled' && kw.scheduled_date) occupied.add(`${kw.scheduled_date}|${l}`);
      }
    }
  }

  // Schedule with cluster rotation:
  // Round 0 → cluster 0, Round 1 → cluster 1, ... Round N → cluster N%count, ...
  // Each round = 1 keyword per language from ONE cluster, same date
  const maxRounds = count || 9999;
  let scheduled = 0;
  let round = 0;
  let emptyRoundsInRow = 0;
  const startDate = new Date();

  while (round < maxRounds && emptyRoundsInRow < pendingPerCluster.length) {
    const clusterIdx = round % pendingPerCluster.length;
    const { byLang } = pendingPerCluster[clusterIdx];

    const schedDate = new Date(startDate);
    schedDate.setDate(schedDate.getDate() + round * intervalDays);
    const dateStr = schedDate.toISOString().split('T')[0];

    let anyScheduled = false;
    for (const l of Object.keys(byLang)) {
      if (occupied.has(`${dateStr}|${l}`)) continue;
      const kw = byLang[l].shift();
      if (kw) {
        kw.status = 'scheduled';
        kw.scheduled_date = dateStr;
        occupied.add(`${dateStr}|${l}`);
        scheduled++;
        anyScheduled = true;
      }
    }

    if (anyScheduled) {
      emptyRoundsInRow = 0;
    } else {
      emptyRoundsInRow++;
    }
    round++;
  }

  saveCalendar(cal);
  res.json({ scheduled, rounds: round });
});

// ─── Content Calendar: Import keywords ───

app.post('/api/calendar/import', (req, res) => {
  const { cluster_id, cluster_name, keywords } = req.body;
  // keywords: { lang: ["kw1", "kw2", ...], ... } or [{keyword, lang}, ...]
  if (!keywords) return res.status(400).json({ error: 'keywords required' });

  const cal = loadCalendar();
  let cluster;

  if (cluster_id) {
    cluster = cal.clusters.find(c => c.id === cluster_id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
  } else {
    cluster = {
      id: Date.now().toString(36),
      name: cluster_name || 'Imported',
      created: new Date().toISOString().split('T')[0],
      keywords: {}
    };
    cal.clusters.push(cluster);
  }

  let imported = 0;
  if (Array.isArray(keywords)) {
    for (const item of keywords) {
      const lang = item.lang || 'en';
      if (!cluster.keywords[lang]) cluster.keywords[lang] = [];
      const existing = new Set(cluster.keywords[lang].map(k => k.keyword.toLowerCase()));
      if (!existing.has(item.keyword.toLowerCase())) {
        cluster.keywords[lang].push({
          keyword: item.keyword, intent: item.intent || 'informational',
          kd: null, serp_verified: false, serp_score: null,
          status: 'pending', scheduled_date: null, slug: null,
          published_date: null, gsc_position: null, gsc_clicks: 0,
          gsc_impressions: 0, gsc_last_check: null
        });
        imported++;
      }
    }
  } else {
    for (const [lang, kwList] of Object.entries(keywords)) {
      if (!cluster.keywords[lang]) cluster.keywords[lang] = [];
      const existing = new Set(cluster.keywords[lang].map(k => k.keyword.toLowerCase()));
      for (const kw of kwList) {
        const kwStr = typeof kw === 'string' ? kw : kw.keyword;
        if (!existing.has(kwStr.toLowerCase())) {
          cluster.keywords[lang].push({
            keyword: kwStr, intent: 'informational',
            kd: null, serp_verified: false, serp_score: null,
            status: 'pending', scheduled_date: null, slug: null,
            published_date: null, gsc_position: null, gsc_clicks: 0,
            gsc_impressions: 0, gsc_last_check: null
          });
          imported++;
        }
      }
    }
  }

  saveCalendar(cal);
  res.json({ ok: true, cluster_id: cluster.id, imported });
});

// ─── Content Calendar: Scheduler (auto-run) ───

let calendarSchedulerInterval = null;

function startCalendarScheduler() {
  if (calendarSchedulerInterval) return;
  calendarSchedulerInterval = setInterval(async () => {
    try {
      const cal = loadCalendar();
      if (!cal.auto_enabled) return;
      if (!cal.next_run) return;
      if (new Date() < new Date(cal.next_run)) return;
      if (calendarProgress && calendarProgress.status === 'running') return;

      console.log(`[Calendar Scheduler] Time to run! next_run was ${cal.next_run}`);

      // Trigger batch (1 per language)
      const batch = findNextBatch(cal);
      if (batch.length === 0) {
        console.log('[Calendar Scheduler] No keywords in queue, disabling auto');
        cal.auto_enabled = false;
        saveCalendar(cal);
        return;
      }

      calendarProgress = {
        status: 'running', batch_total: batch.length, batch_done: 0,
        keyword: batch[0].keyword, lang: batch[0].lang,
        step: 'writing', results: [], started: new Date().toISOString()
      };

      for (const kw of batch) {
        updateKeywordStatus(cal, kw.lang, kw.keyword, { status: 'writing' });
      }
      saveCalendar(cal);

      // Per-keyword full pipeline: write → build → deploy → GSC → next
      let completed = 0;
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const label = `[Scheduler] [${i + 1}/${batch.length}] [${item.lang}]`;
        calendarProgress.batch_done = i;
        calendarProgress.keyword = item.keyword;
        calendarProgress.lang = item.lang;

        try {
          // Step 1: Write article
          calendarProgress.step = `writing (${i + 1}/${batch.length})`;
          console.log(`${label} Autopilot: ${item.keyword}`);
          const result = await runAutopilot(item.lang, item.keyword);
          const slug = result.slug;

          // Step 2: Build
          calendarProgress.step = `build (${i + 1}/${batch.length})`;
          console.log(`${label} Building...`);
          execSync('node build.js', { cwd: LANDING_ROOT, timeout: 60000 });

          // Step 3: Deploy to FTP
          calendarProgress.step = `deploy (${i + 1}/${batch.length})`;
          console.log(`${label} Deploying...`);
          await new Promise((resolve, reject) => {
            exec('node deploy.js', { cwd: LANDING_ROOT, timeout: 120000 }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message)); else resolve(stdout);
            });
          });

          // Step 4: GSC submit
          calendarProgress.step = `gsc (${i + 1}/${batch.length})`;
          const articleUrl = `https://healthdesk.site/${item.lang}/blog/${slug}/`;
          if (fs.existsSync(GSC_KEY_PATH)) {
            try {
              const { google } = require('googleapis');
              const auth = new google.auth.GoogleAuth({ keyFile: GSC_KEY_PATH, scopes: ['https://www.googleapis.com/auth/indexing'] });
              const indexing = google.indexing({ version: 'v3', auth });
              await indexing.urlNotifications.publish({ requestBody: { url: articleUrl, type: 'URL_UPDATED' } });
              console.log(`${label} GSC submitted: ${articleUrl}`);
            } catch (gscErr) {
              console.error(`${label} GSC failed: ${gscErr.message}`);
            }
          }

          // Update statuses
          const cal2 = loadCalendar();
          updateKeywordStatus(cal2, item.lang, item.keyword, {
            status: 'published', slug, published_date: new Date().toISOString().split('T')[0]
          });
          saveCalendar(cal2);

          const studio = loadStudioData();
          studio.articles[`${item.lang}/${slug}`] = { status: 'published' };
          saveStudioData(studio);

          calendarProgress.results.push({ lang: item.lang, slug, status: 'ok' });
          completed++;
          console.log(`${label} DONE — ${slug} is LIVE (${completed}/${batch.length})`);

        } catch (err) {
          console.error(`${label} Error: ${err.message}`);
          calendarProgress.results.push({ lang: item.lang, keyword: item.keyword, status: 'error', error: err.message });
          const cal2 = loadCalendar();
          updateKeywordStatus(cal2, item.lang, item.keyword, { status: 'scheduled' });
          saveCalendar(cal2);
        }
      }

      const cal3 = loadCalendar();
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + (cal3.interval_days || 3));
      cal3.next_run = nextDate.toISOString();
      saveCalendar(cal3);

      calendarProgress.status = 'done';
      calendarProgress.batch_done = batch.length;
      console.log(`[Scheduler] Batch done: ${completed}/${batch.length}, next: ${cal3.next_run}`);

    } catch (err) {
      console.error('[Calendar Scheduler] Error:', err.message);
      if (calendarProgress) {
        calendarProgress.status = 'error';
        calendarProgress.error = err.message;
      }
    }

    setTimeout(() => {
      if (calendarProgress && calendarProgress.status !== 'running') calendarProgress = null;
    }, 120000);
  }, 3600000); // Check every hour
  console.log('[Calendar Scheduler] Started (checking every hour)');
}

// ─── Start ───
const server = app.listen(PORT, () => {
  console.log(`\n  Blog Studio running at http://localhost:${PORT}\n`);
  console.log(`  Blog dir:  ${BLOG_DIR}`);
  console.log(`  Dist dir:  ${DIST_DIR}`);
  console.log(`  Studio DB: ${STUDIO_DATA}\n`);
});
server.timeout = 300000;       // 5 min
server.keepAliveTimeout = 300000;

// Start calendar scheduler
startCalendarScheduler();
