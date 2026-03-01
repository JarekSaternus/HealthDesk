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
  const { title, description, outline, lang, keyword, slug, persona } = req.body;
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

  const systemPrompt = `You are a health & productivity blog writer for HealthDesk (desktop wellness app). Write in ${langName}. Your goal is to produce articles that read as if written by a knowledgeable human — NOT a generic AI.

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

// ─── AI: Humanize article (remove AI patterns) ───
app.post('/api/ai/humanize', async (req, res) => {
  const { markdown, lang } = req.body;
  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';

  console.log(`[AI Humanize] Processing ${markdown?.length || 0} chars in ${langName}`);

  try {
    const result = await callClaude(
      `You are an experienced editor who humanizes AI-generated content. Write in ${langName}. Your task is to transform the given text so it sounds like it was written by a real person — an expert who blogs with passion, not a robot producing content.`,
      `STEP 1: DIAGNOSE — Before editing, analyze the article and list 5-7 specific AI-pattern problems you found (with quotes from the text). Output them as a brief numbered list at the very top, wrapped in <!-- DIAGNOSIS: ... --> HTML comment.

STEP 2: FIX — Then output the fully rewritten article applying ALL fixes below.

## 1. STRUCTURE & RHYTHM
- Vary paragraph lengths (mix: 1-sentence, 3-sentence, 5-sentence)
- Vary sentence lengths (mix short punchy with longer complex ones)
- Break the perfect symmetry of sections — not every section should have exactly 3 paragraphs
- Add 1-2 single-sentence paragraphs for dramatic effect
- Remove or relocate duplicate information (AI often repeats the same data in different sections)
- If a list has only 3 items, convert it to a flowing sentence instead

## 2. VOICE & PERSONALITY
- Add 2-3 personal interjections: "from my experience", "I've tested this myself", "I'll admit, at first…"
- Insert 1 controversial opinion or caveat: "this doesn't suit everyone", "this isn't a magic bullet"
- Add 1-2 rhetorical questions directed at the reader: "You know that feeling when...?"
- Insert 1 colloquial/informal expression (don't overdo it, but keep it human)
- Remove unnecessary formal phrases: "it's worth noting that", "there is no doubt", "for this reason", "furthermore", "moreover", "it should be highlighted that", "in today's dynamic world", "a key aspect is", "needless to say"
- Add 1 brief digression or anecdote (even 2 sentences) — this is the most human element

## 3. FORMATTING (anti-AI)
- Reduce bolds — max 3-4 per 1000 words (AI overuses bold)
- Don't bold every other paragraph — bold should be the exception
- Don't start every section with a defining sentence ("X is a technique that…")
- Vary how paragraphs open (don't start from the same pattern)
- Don't end every section with a CTA or summary

## 4. DATA & SOURCES
- Max 3-4 statistics in the ENTIRE article — replace the rest with soft observations ("many users report that…")
- Add context to statistics ("this 2022 study…", "though the numbers may vary")
- Don't drop stats without commentary — add an interpreting sentence
- When studies are mentioned without links, add real external source links (WHO, PubMed, university domains)

## 5. INTERNAL LINKS / PRODUCT
- Max 2-3 product mentions in the entire article
- Product mentions should arise from context, not be forced
- Don't start or end the article with product promotion

## 6. KEYWORDS (anti-stuffing)
- Check if the main keyword appears more than 5-7 times per 2000 words — if so, replace excess with synonyms
- Use variants: "technique", "system", "approach", "this method", etc.
- Keywords should sound natural in the sentence — if grammar bends to fit the phrase, rewrite it

## 7. INTRO & OUTRO
- Intro should NOT be encyclopedic — if it starts with a definition, rewrite to start from the reader's problem, a question, or brief story
- Outro should NOT be a formulaic "In summary…" — end with a concrete takeaway, call to action, or reflection

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
    console.log(`[AI Humanize] Done: ${cleaned.length} chars`);
    res.json({ markdown: cleaned });
  } catch (err) {
    console.error(`[AI Humanize] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── AI: Audit article for AI fingerprints ───
app.post('/api/ai/audit', async (req, res) => {
  const { markdown, lang } = req.body;
  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';

  console.log(`[AI Audit] Analyzing ${markdown?.length || 0} chars in ${langName}`);

  try {
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
      3000
    );

    const parsed = parseJsonResponse(result);
    console.log(`[AI Audit] Score: ${parsed.score}/10`);
    res.json(parsed);
  } catch (err) {
    console.error(`[AI Audit] Error: ${err.message}`);
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

// ─── AI: Internal Linking Suggestions ───
app.post('/api/ai/internal-links', async (req, res) => {
  const { lang, slug } = req.body;
  if (!lang || !slug) return res.status(400).json({ error: 'lang and slug required' });

  const langDir = path.join(BLOG_DIR, lang);
  const filePath = path.join(langDir, slug + '.md');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Article not found' });

  const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', sv: 'Swedish', ja: 'Japanese', ko: 'Korean', zh: 'Chinese' }[lang] || 'English';

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

app.post('/api/ai/generate-image', async (req, res) => {
  const { slug, lang, title, description, style } = req.body;
  const apiKey = getGeminiKey();
  if (!apiKey) return res.status(400).json({ error: 'No Gemini API key configured. Add gemini_api_key to studio.json' });

  try {
    const langName = { pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' }[lang] || 'English';
    const styleHint = style || 'clean, modern, professional';

    // Single Gemini call: generate image + alt text
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
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE']
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || `Gemini API error: ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();

    // Extract image and alt text from response
    let imageBase64 = null;
    let imageMime = null;
    let altText = title; // fallback
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

    if (!imageBase64) {
      throw new Error('Gemini did not return an image. Try again.');
    }

    console.log(`[Image] Received ${imageMime} image, converting to WebP...`);
    const imgBuffer = Buffer.from(imageBase64, 'base64');

    // Convert and optimize with sharp → WebP 1200x630
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
        let fm = fmMatch[1];
        if (fm.includes('image_alt:')) {
          fm = fm.replace(/image_alt:.*/, `image_alt: "${altText}"`);
        } else {
          fm += `\nimage_alt: "${altText}"`;
        }
        const updated = mdContent.replace(/^---\n[\s\S]*?\n---/, `---\n${fm}\n---`);
        fs.writeFileSync(mdFile, updated, 'utf8');
        console.log(`[Image] Saved image_alt to frontmatter: "${altText}"`);
      }
    }

    res.json({
      ok: true,
      filename,
      path: `/images/blog/${filename}`,
      altText,
      prompt: imagePrompt.split('\n')[0],
      size: `${(stats.size / 1024).toFixed(1)} KB`
    });
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

// ─── Start ───
const server = app.listen(PORT, () => {
  console.log(`\n  Blog Studio running at http://localhost:${PORT}\n`);
  console.log(`  Blog dir:  ${BLOG_DIR}`);
  console.log(`  Dist dir:  ${DIST_DIR}`);
  console.log(`  Studio DB: ${STUDIO_DATA}\n`);
});
server.timeout = 300000;       // 5 min
server.keepAliveTimeout = 300000;
