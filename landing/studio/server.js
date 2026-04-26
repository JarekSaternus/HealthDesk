#!/usr/bin/env node
/**
 * HealthDesk Blog Studio â€” Local server
 * Express backend for blog content management pipeline.
 * Run: npm start (from landing/studio/)
 *
 * Secrets (FTP_PASS for deploy.js, API keys if overriding studio.json) are
 * read from `.env` in this directory. `.env` is gitignored — never commit it.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync, exec, execFile } = require('child_process');
const fm = require('front-matter');
const { marked } = require('marked');
const sharp = require('sharp');

const app = express();
const PORT = 4000;

function readJsonFile(filePath, fallback = undefined) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

// â”€â”€â”€ Windows Toast Notification helper â”€â”€â”€
function showNotification(title, message) {
  try {
    const scriptPath = path.join(__dirname, 'notify.ps1');
    // Base64-UTF8 args — Windows ANSI code page (CP1250) psuje polskie znaki
    // gdy przekazujemy je bezpośrednio jako execFile args do powershell.exe.
    const titleB64 = Buffer.from(String(title), 'utf8').toString('base64');
    const messageB64 = Buffer.from(String(message), 'utf8').toString('base64');
    execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-TitleB64', titleB64, '-MessageB64', messageB64], { timeout: 10000 }, (err) => {
      if (err) console.error('[Notification] Failed:', err.message);
    });
  } catch (e) {
    console.error('[Notification] Failed:', e.message);
  }
}

// â”€â”€â”€ Language name mapping â”€â”€â”€
const LANG_NAMES = {
  pl: 'Polish', en: 'English', de: 'German', es: 'Spanish', fr: 'French',
  it: 'Italian', 'pt-BR': 'Brazilian Portuguese', ja: 'Japanese',
  'zh-CN': 'Simplified Chinese', ko: 'Korean', tr: 'Turkish', ru: 'Russian',
  nl: 'Dutch', sv: 'Swedish', pt: 'Portuguese', zh: 'Chinese'
};
function getLangName(lang) { return LANG_NAMES[lang] || lang; }

const MOJIBAKE_PATTERN = /(?:Ă.|Ä.|Å.|â€|ďż˝|\?\?\?|cannotreliablyprocess|imunabletogenerate)/i;

function hasBrokenEncoding(value) {
  return MOJIBAKE_PATTERN.test(String(value || ''));
}

function normalizeDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim().replace(/^"|"$/g, '');
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// â”€â”€â”€ Claude API â”€â”€â”€
function getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return key;
  try {
    const data = readJsonFile(path.join(__dirname, 'studio.json'), {});
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

function stripMarkdownFences(text) {
  let cleaned = String(text || '').trim().replace(/^\uFEFF/, '');
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json|markdown)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

function extractFirstJsonBlock(text) {
  const start = text.search(/[\[{]/);
  if (start === -1) return null;

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const open = stack[stack.length - 1];
      if ((open === '{' && ch === '}') || (open === '[' && ch === ']')) {
        stack.pop();
        if (stack.length === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }

  return text.slice(start);
}

function repairJsonCandidate(text) {
  let fixed = text
    .replace(/^[^\[{]*/, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < fixed.length; i++) {
    const ch = fixed[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      const open = stack[stack.length - 1];
      if ((open === '{' && ch === '}') || (open === '[' && ch === ']')) {
        stack.pop();
      }
    }
  }

  if (inString) fixed += '"';

  while (stack.length > 0) {
    const open = stack.pop();
    fixed += open === '{' ? '}' : ']';
  }

  return fixed;
}

function parseJsonResponse(text) {
  const cleaned = stripMarkdownFences(text);
  const candidates = [];

  if (cleaned) candidates.push(cleaned);
  const extracted = extractFirstJsonBlock(cleaned);
  if (extracted && !candidates.includes(extracted)) candidates.push(extracted);

  const errors = [];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (e) {
      errors.push(e.message);
      try {
        return JSON.parse(repairJsonCandidate(candidate));
      } catch (e2) {
        errors.push(e2.message);
      }
    }
  }

  const preview = cleaned.slice(0, 160).replace(/\s+/g, ' ');
  throw new Error(`${errors[0] || 'Invalid JSON response'} | preview: ${preview}`);
}

// Paths
const LANDING_ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(LANDING_ROOT, 'src', 'content', 'blog');
const I18N_DIR = path.join(LANDING_ROOT, 'src', 'i18n');
const STUDIO_DATA = path.join(__dirname, 'studio.json');
const DIST_DIR = path.join(LANDING_ROOT, 'dist');
const DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;

// Path-traversal guards: req.params.lang / req.params.slug / req.params.filename
// trafiają do path.join — bez tych regexów `../../etc/passwd` ucieka z BLOG_DIR.
const VALID_LANG_RE = /^[a-z]{2}(-[A-Z]{2})?$/;          // pl, en, pt-BR, zh-CN
const VALID_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/;
const VALID_WEBP_RE = /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]\.webp$/;
function isValidLang(s)  { return typeof s === 'string' && VALID_LANG_RE.test(s); }
function isValidSlug(s)  { return typeof s === 'string' && VALID_SLUG_RE.test(s); }
function isValidWebp(s)  { return typeof s === 'string' && VALID_WEBP_RE.test(s); }

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// â”€â”€â”€ Studio data (statuses, notes) â”€â”€â”€
function loadStudioData() {
  if (fs.existsSync(STUDIO_DATA)) {
    return readJsonFile(STUDIO_DATA, { articles: {}, ideas: [] });
  }
  return { articles: {}, ideas: [] };
}

function saveStudioData(data) {
  fs.writeFileSync(STUDIO_DATA, JSON.stringify(data, null, 2), 'utf8');
}

function upsertFrontmatterFields(filePath, fields) {
  if (!fs.existsSync(filePath)) return false;

  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---(\n?[\s\S]*)$/);
  if (!match) return false;

  let frontmatter = match[1];
  const body = match[2] || '\n';

  for (const [key, value] of Object.entries(fields || {})) {
    if (value === null || value === undefined || value === '') continue;
    const escaped = String(value).replace(/"/g, '\\"');
    const line = `${key}: "${escaped}"`;
    const re = new RegExp(`^${key}:.*$`, 'm');
    if (re.test(frontmatter)) {
      frontmatter = frontmatter.replace(re, line);
    } else {
      frontmatter += `\n${line}`;
    }
  }

  fs.writeFileSync(filePath, `---\n${frontmatter}\n---${body.startsWith('\n') ? body : '\n' + body}`, 'utf8');
  return true;
}

function transliterateToAscii(value) {
  const map = {
    ss: /ß/g,
    ae: /æ/gi,
    oe: /œ/gi,
    o: /ø/gi,
    d: /[ðđ]/gi,
    th: /þ/gi,
    l: /ł/gi,
    i: /[ıİ]/g,
    g: /ğ/gi,
    s: /ş/gi,
    c: /ç/gi,
    n: /ñ/gi,
    a: /å/gi,
    zh: /ж/gi,
    kh: /х/gi,
    ts: /ц/gi,
    ch: /ч/gi,
    sh: /ш/gi,
    sch: /щ/gi,
    yu: /ю/gi,
    ya: /я/gi,
    yo: /ё/gi
  };

  let output = String(value || '');
  for (const [replacement, pattern] of Object.entries(map)) {
    output = output.replace(pattern, replacement);
  }

  const cyrillicMap = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', ы: 'y', э: 'e', ь: '', ъ: ''
  };

  output = output.replace(/[а-бвгдезийклмнопрстуфыэьъ]/gi, char => {
    const lower = char.toLowerCase();
    const replacement = cyrillicMap[lower] ?? '';
    return char === lower ? replacement : replacement.toUpperCase();
  });

  return output.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function sanitizeSlug(value) {
  return transliterateToAscii(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function isSuspiciousSlug(slug) {
  const value = String(slug || '').trim().toLowerCase();
  if (!value) return true;
  if (!/^[a-z0-9-]{3,80}$/.test(value)) return true;
  if (/(^|-)article-[a-z0-9]{4,}$/.test(value)) return true;
  if (/(cannotreliablyprocess|imunabletogenerate|corruptedtext|encodingerrors)/.test(value)) return true;
  if (/([a-z]-){3,}[a-z]/.test(value)) return true;
  return false;
}

function getPublishedArticleUrl(lang, slug) {
  return `https://healthdesk.site/${lang}/blog/${slug}/`;
}

function syncPublishedFrontmatterDate(lang, slug, publishedDate) {
  const normalizedDate = normalizeDateOnly(publishedDate);
  if (!normalizedDate) return false;

  const mdFile = path.join(BLOG_DIR, lang, `${slug}.md`);
  if (!fs.existsSync(mdFile)) return false;

  return upsertFrontmatterFields(mdFile, { date: normalizedDate });
}

// â”€â”€â”€ API: List all articles â”€â”€â”€
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

// â”€â”€â”€ API: Get single article â”€â”€â”€
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

// â”€â”€â”€ API: Save article â”€â”€â”€
app.put('/api/articles/:lang/:slug', (req, res) => {
  const { lang, slug } = req.params;
  if (!isValidLang(lang) || !isValidSlug(slug)) return res.status(400).json({ error: 'Invalid lang or slug' });
  const { frontmatter, markdown } = req.body;
  if (frontmatter && frontmatter.slug && !isValidSlug(frontmatter.slug)) return res.status(400).json({ error: 'Invalid frontmatter.slug' });

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

// â”€â”€â”€ API: Create new article â”€â”€â”€
app.post('/api/articles', (req, res) => {
  const { lang, slug, title } = req.body;
  if (!isValidLang(lang) || !isValidSlug(slug)) return res.status(400).json({ error: 'Invalid lang or slug' });

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

// â”€â”€â”€ API: Delete article â”€â”€â”€
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

// â”€â”€â”€ API: Update article status â”€â”€â”€
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

// â”€â”€â”€ API: SEO analysis â”€â”€â”€
app.post('/api/seo/analyze', (req, res) => {
  const { frontmatter, markdown, lang } = req.body;
  const result = analyzeSEO(frontmatter, markdown, lang);
  res.json(result);
});

// â”€â”€â”€ API: Grammar check (LanguageTool) â”€â”€â”€
// Custom dictionary â€” words to ignore in grammar check
const CUSTOM_DICTIONARY = [
  'Pomodoro', 'pomodoro', 'Cirillo', 'HealthDesk', 'healthdesk',
  'Todoist', 'Notion', 'GTD', 'Draugiem', 'DeskTime',
  'Stretchly', 'Workrave', 'EyeLeo', 'Pomy',
  'ultradian', 'ultradiaĹ„skimi', 'mikroprzerwy', 'mikro-Ä‡wiczenia',
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
        // Skip Polish curly quote "unmatched" warnings (typographic quotes â€ž")
        if (m.rule && m.rule.id && m.rule.id.includes('NIESP') && (flagged === 'â€ž' || flagged === '"')) return false;
        return true;
      });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ API: Readability analysis â”€â”€â”€
app.post('/api/check/readability', (req, res) => {
  const { text, lang } = req.body;
  res.json(analyzeReadability(text, lang));
});

// â”€â”€â”€ API: Build â”€â”€â”€
app.post('/api/build', async (req, res) => {
  try {
    const output = await runBuild(30000);
    res.json({ ok: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ API: Preview (check if dist exists) â”€â”€â”€
app.get('/api/preview/status', (req, res) => {
  const exists = fs.existsSync(DIST_DIR);
  const pages = exists ? countFiles(DIST_DIR, '.html') : 0;
  res.json({ exists, pages });
});

// Serve dist for preview
app.use('/preview', express.static(DIST_DIR));
// Serve dist assets at root level too (HTML uses absolute paths like /style.css)
app.use(express.static(DIST_DIR));

// â”€â”€â”€ API: Deploy â”€â”€â”€
app.post('/api/deploy', (req, res) => {
  exec('node --use-system-ca deploy.js', { cwd: LANDING_ROOT, timeout: DEPLOY_TIMEOUT_MS }, (err, stdout, stderr) => {
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

// â”€â”€â”€ API: Ideas â”€â”€â”€
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

// â”€â”€â”€ Serper API helper â”€â”€â”€
function getSerperKey() {
  try {
    const data = readJsonFile(path.join(__dirname, 'studio.json'), {});
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

function truncateSerperQuery(q, maxChars = 100) {
  if (typeof q !== 'string' || q.length <= maxChars) return q;
  const slice = q.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
}

function runBuild(timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    exec('node build.js', { cwd: LANDING_ROOT, encoding: 'utf8', timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function serperRequest(endpoint, body) {
  const key = getSerperKey();
  if (!key) throw new Error('No serper_api_key configured in studio.json');

  if (body && typeof body.q === 'string') {
    body = { ...body, q: truncateSerperQuery(body.q) };
  }

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

// â”€â”€â”€ Helper: Keyword search â”€â”€â”€
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

// â”€â”€â”€ API: Keyword search (Serper) â”€â”€â”€
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

// â”€â”€â”€ Helper: Keyword AI analysis â”€â”€â”€
async function doKeywordAnalyze(query, lang, serp) {
  const langName = getLangName(lang);

  const serpSummary = (serp.organic || []).map((r, i) =>
    `${i+1}. "${r.title}" â€” ${r.link}\n   ${r.snippet}`
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

// â”€â”€â”€ API: Keyword AI analysis â”€â”€â”€
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

// â”€â”€â”€ Helper: AI outline â”€â”€â”€
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

// â”€â”€â”€ AI: Generate outline from keyword â”€â”€â”€
app.post('/api/ai/outline', async (req, res) => {
  const { keyword, lang } = req.body;
  try {
    res.json(await doOutline(keyword, lang));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ AI Draft: progress tracking â”€â”€â”€
let draftProgress = null; // { slug, lang, title, chunk, totalChunks, sections, status, startedAt, words }

app.get('/api/ai/draft/status', (req, res) => {
  res.json(draftProgress || { status: 'idle' });
});

// â”€â”€â”€ Helper: AI draft (chunked writing + FAQ) â”€â”€â”€
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

  const systemPrompt = `You are a health & productivity blog writer for HealthDesk (desktop wellness app). Write ENTIRELY in ${langName} â€” every word, heading, sentence must be in ${langName}. NEVER use English (unless the target language IS English). Your goal is to produce articles that read as if written by a knowledgeable native ${langName} speaker â€” NOT a generic AI.

VOICE & TONE:
- Write like a real person sharing expertise â€” use "I", share brief personal observations or anecdotes (e.g. "I noticed thatâ€¦", "In my experienceâ€¦", "I've seen this with clientsâ€¦")
- Vary paragraph lengths deliberately: mix 1-sentence punchy paragraphs with longer 4-5 sentence ones. Asymmetry is key.
- Vary sentence lengths: mix short punchy sentences with longer complex ones. Monotonous rhythm = AI tell.
- Include at least one moment of honest friction per article â€” a counterargument, limitation, or "this doesn't work for everyone" caveat
- Ask rhetorical questions to engage the reader (2-3 per article max, not in every section)
- Use 1 colloquial/informal expression per article to break the "textbook" feel (e.g. "let's be honest", "sounds great on paper, butâ€¦")
- Use bold sparingly â€” max 3-4 bolded terms per 1000 words. Bold is the exception, not the norm.

STRUCTURE:
- INTRO: Start from the reader's problem, a question, or a brief anecdote â€” NEVER from a definition ("X is a technique thatâ€¦")
- First paragraph after each H2: concise answer (40-60 words) â€” optimized for featured snippets. But vary how you open â€” not every section should start the same way.
- Vary section structure â€” NOT every section should follow the same pattern. Mix: stories â†’ data, data â†’ practical tip, question â†’ answer â†’ nuance. Sections should have DIFFERENT lengths (some 2 paragraphs, some 5).
- Use H2 headings phrased as questions to maximize FAQ schema extraction
- Include at least ONE markdown comparison/summary table per article (use | syntax)
- OUTRO: End with a concrete takeaway or reflection â€” NEVER with "In summaryâ€¦", "To concludeâ€¦", "In today's fast-paced worldâ€¦"
- If a list has only 3 items, write it as a sentence instead of bullet points

DATA & STATS:
- Max 3-4 statistics/data points in the ENTIRE article â€” the rest should be observations and experience
- Always add an interpreting sentence after a statistic (don't just drop numbers)
- Add context: "this 2022 studyâ€¦", "though the sample was smallâ€¦"
- Cite external sources with real links: [Journal name](https://doi.org/...), [WHO](https://www.who.int/...)
- Never repeat the same statistic or data point in different sections

LINKS:
- Link to HealthDesk ONLY 2-3 times in the ENTIRE article, naturally where truly relevant (link format: [HealthDesk](https://healthdesk.site/${lang}/))
- Do NOT force a HealthDesk mention in every section. Do NOT start or end the article with product promotion.
- Do NOT end sections with a CTA to the product

SEO:
- Use the target keyword naturally â€” max 4-5 exact matches per 2000 words. Use synonyms and related terms for the rest ("technique", "system", "approach", "this method").
- Do NOT write a conclusion unless explicitly told to

BANNED PHRASES (never use these â€” they are AI fingerprints):
"it's worth noting", "it goes without saying", "in today's fast-paced world", "a key aspect is", "furthermore,", "moreover,", "it's important to highlight", "without a doubt", "for this reason", "in conclusion", "to summarize", "as we all know", "needless to say", "it should be noted that", "in the modern era"
Equivalent banned phrases in Polish: "warto zauwaĹĽyÄ‡", "nie ulega wÄ…tpliwoĹ›ci", "w dzisiejszym dynamicznym Ĺ›wiecie", "kluczowym aspektem jest", "co wiÄ™cej,", "ponadto,", "warto podkreĹ›liÄ‡, ĹĽe", "z tego wzglÄ™du", "podsumowujÄ…c", "jak wszyscy wiemy", "nie trzeba dodawaÄ‡", "naleĹĽy zauwaĹĽyÄ‡, ĹĽe"
Equivalent banned phrases in German: "es ist erwĂ¤hnenswert", "zweifellos", "in der heutigen schnelllebigen Welt", "ein wesentlicher Aspekt ist", "darĂĽber hinaus", "zusammenfassend", "es sei darauf hingewiesen"
Equivalent banned phrases in Spanish: "cabe destacar", "sin lugar a dudas", "en el mundo actual", "un aspecto clave es", "ademĂˇs,", "en resumen", "es importante seĂ±alar"
Equivalent banned phrases in French: "il convient de noter", "sans aucun doute", "dans le monde d'aujourd'hui", "un aspect clĂ© est", "de plus,", "en rĂ©sumĂ©", "il est important de souligner"`;

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
      ? '\n\nThis is the LAST chunk â€” end with a brief conclusion section (## header + 2-3 sentences).'
      : '\n\nDo NOT end with a conclusion â€” more sections follow.';

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
      // Note: tags populated later by autopilot's final save step
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

// â”€â”€â”€ AI: Write full draft from outline â”€â”€â”€
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

// â”€â”€â”€ Helper: AI description â”€â”€â”€
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

// â”€â”€â”€ AI: Suggest meta description â”€â”€â”€
app.post('/api/ai/description', async (req, res) => {
  const { markdown, title, lang } = req.body;
  try {
    const description = await doDescription(markdown, title, lang);
    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Helper: Humanize article â”€â”€â”€
const LANG_GUIDELINES = {
  pl: {
    name: 'Polish',
    formalPhrases: `"warto zauwaĹĽyÄ‡", "nie ulega wÄ…tpliwoĹ›ci", "w dzisiejszych czasach", "kluczowym aspektem jest", "nie sposĂłb nie wspomnieÄ‡", "z caĹ‚Ä… pewnoĹ›ciÄ…", "w zwiÄ…zku z powyĹĽszym", "ponadto", "co wiÄ™cej", "naleĹĽy podkreĹ›liÄ‡", "w kontekĹ›cie", "biorÄ…c pod uwagÄ™", "nie da siÄ™ ukryÄ‡, ĹĽe"`,
    personalPhrases: `"z mojego doĹ›wiadczenia", "sam/sama to testowaĹ‚em/am", "przyznam, ĹĽe na poczÄ…tkuâ€¦", "u mnie sprawdza siÄ™", "powiem szczerze"`,
    softStats: `"wielu uĹĽytkownikĂłw zauwaĹĽa, ĹĽeâ€¦", "z praktyki wynika, ĹĽeâ€¦", "badania sugerujÄ…, ĹĽeâ€¦"`,
    style: `- Use "ty" form (2nd person singular informal), NOT "PaĹ„stwo" or "Pan/Pani"
- Use natural Polish word order â€” don't calque English sentence structures
- Contractions are fine: "nie da siÄ™" instead of "nie jest to moĹĽliwe"
- Rhetorical questions: "Znasz to uczucie, gdy...?", "Ile razy zdarzyĹ‚o ci siÄ™...?"
- Polish allows longer sentences than English â€” but still vary them
- Avoid unnecessary Anglicisms: use "przerwa" not "break", "technika" not overused "metoda"
- Colloquial interjections: "no i co?", "serio?", "brzmi znajomo?", "no wĹ‚aĹ›nie"
- Polish readers appreciate warmth and directness â€” write like talking to a friend over coffee`,
  },
  en: {
    name: 'English',
    formalPhrases: `"it's worth noting that", "there is no doubt", "for this reason", "furthermore", "moreover", "it should be highlighted that", "in today's dynamic world", "a key aspect is", "needless to say", "it goes without saying", "at the end of the day", "in conclusion"`,
    personalPhrases: `"from my experience", "I've tested this myself", "I'll admit, at firstâ€¦", "here's what works for me"`,
    softStats: `"many users report thatâ€¦", "research suggests thatâ€¦", "from what we've seenâ€¦"`,
    style: `- Use conversational contractions: "don't", "isn't", "we've", "you'll"
- Mix short punchy sentences with longer ones â€” English thrives on rhythm
- Use active voice: "you'll notice" not "it can be noticed"
- Rhetorical questions: "Ever noticed how...?", "Sound familiar?"
- Colloquial: "here's the thing", "turns out", "spoiler alert", "let's be honest"
- Keep consistent American English spelling`,
  },
  de: {
    name: 'German',
    formalPhrases: `"es ist erwĂ¤hnenswert", "zweifellos", "darĂĽber hinaus", "des Weiteren", "es sei darauf hingewiesen", "in der heutigen Zeit", "ein wesentlicher Aspekt", "selbstverstĂ¤ndlich", "es versteht sich von selbst", "im Folgenden", "abschlieĂźend lĂ¤sst sich sagen", "es ist unbestritten"`,
    personalPhrases: `"aus meiner Erfahrung", "ich habe das selbst getestet", "ich gebe zu, anfangsâ€¦", "was bei mir funktioniert", "ganz ehrlich"`,
    softStats: `"viele Nutzer berichten, dassâ€¦", "Studien deuten darauf hin, dassâ€¦", "in der Praxis zeigt sichâ€¦"`,
    style: `- Use "du" form (informal) for blog content, NOT "Sie"
- Simplify subordinate clause chains â€” German AI text tends to nest too deeply
- Use natural compound words: "Arbeitsplatzergonomie", "Bildschirmarbeit"
- Avoid direct English calques â€” use German idioms: "Hand aufs Herz", "mal ehrlich"
- Rhetorical questions: "Kennst du das GefĂĽhl, wenn...?", "Kommt dir das bekannt vor?"
- Colloquial: "mal ehrlich", "und zwar", "klingt vertraut?", "SpaĂź beiseite"
- German readers expect depth â€” don't oversimplify, but break up dense passages
- Avoid overusing "man" (impersonal) â€” address the reader directly with "du"`,
  },
  es: {
    name: 'Spanish',
    formalPhrases: `"cabe destacar", "sin lugar a dudas", "por esta razĂłn", "ademĂˇs", "asimismo", "es importante seĂ±alar que", "en la actualidad", "un aspecto clave es", "huelga decir", "dicho lo anterior", "en definitiva", "resulta evidente que"`,
    personalPhrases: `"por experiencia propia", "yo mismo lo he probado", "te confieso que al principioâ€¦", "a mĂ­ me funciona", "siendo honesto"`,
    softStats: `"muchos usuarios notan queâ€¦", "los estudios sugieren queâ€¦", "en la prĂˇctica se observa queâ€¦"`,
    style: `- Use "tĂş" form (informal), NOT "usted"
- Spanish is naturally more verbose â€” embrace it, but vary sentence lengths
- Rhetorical questions: "ÂżTe suena?", "ÂżCuĂˇntas veces te ha pasado que...?"
- Avoid anglicisms: use "enlace" not "link", "pantalla" not "display"
- Emphatic structures: "Lo que sĂ­ funciona esâ€¦", "El problema real es queâ€¦"
- Colloquial: "la verdad es que", "ojo", "vamos a lo importante", "seamos sinceros"
- Don't forget inverted punctuation: Âż Âˇ
- Latin American vs Spain: prefer neutral Spanish that works for both`,
  },
  fr: {
    name: 'French',
    formalPhrases: `"il convient de noter", "sans aucun doute", "c'est pourquoi", "en outre", "de surcroĂ®t", "il est important de souligner", "dans le monde actuel", "un aspect clĂ© est", "il va sans dire", "en dĂ©finitive", "force est de constater", "il est indĂ©niable que"`,
    personalPhrases: `"d'aprĂ¨s mon expĂ©rience", "j'ai testĂ© cela moi-mĂŞme", "j'avoue qu'au dĂ©butâ€¦", "ce qui marche pour moi", "honnĂŞtement"`,
    softStats: `"beaucoup d'utilisateurs remarquent queâ€¦", "les Ă©tudes suggĂ¨rent queâ€¦", "dans la pratique, on observe queâ€¦"`,
    style: `- Use "tu" form for blog content â€” casual, direct, like talking to a colleague
- French values elegance â€” avoid repeating the same word in nearby sentences, use synonyms
- Rhetorical questions: "Tu connais cette sensation quand...?", "Ă‡a te parle?"
- Avoid English borrowings when French alternatives exist
- French-specific expressions: "entre nous", "avouons-le", "c'est lĂ  que Ă§a se complique"
- Colloquial: "bon", "du coup", "en gros", "soyons honnĂŞtes"
- French readers expect intellectual engagement â€” don't dumb things down
- Liaison and rhythm matter â€” read sentences aloud mentally to check flow`,
  },
  it: {
    name: 'Italian',
    formalPhrases: `"Ă¨ opportuno sottolineare", "non vi Ă¨ dubbio", "in quest'ottica", "inoltre", "altresĂ¬", "Ă¨ importante evidenziare che", "nel contesto attuale", "un aspetto fondamentale Ă¨", "va da sĂ©", "in conclusione", "Ă¨ innegabile che", "alla luce di quanto sopra"`,
    personalPhrases: `"dalla mia esperienza", "l'ho provato personalmente", "ammetto che all'inizioâ€¦", "per me funziona", "onestamente"`,
    softStats: `"molti utenti notano cheâ€¦", "gli studi suggeriscono cheâ€¦", "nella pratica si osserva cheâ€¦"`,
    style: `- Use "tu" form (informal), NOT "Lei"
- Italian loves rhythm and melody â€” vary sentence length for musicality
- Rhetorical questions: "Ti Ă¨ mai capitato di...?", "Ti suona familiare?"
- Avoid anglicisms: use "collegamento" not "link", "schermo" not "display"
- Colloquial: "la veritĂ  Ă¨ che", "occhio", "andiamo al sodo", "siamo onesti"
- Italian readers appreciate warmth and expressiveness â€” don't be too dry
- Use emphatic structures: "Il punto Ă¨ cheâ€¦", "Quello che funziona davvero Ă¨â€¦"`,
  },
  'pt-BR': {
    name: 'Brazilian Portuguese',
    formalPhrases: `"vale ressaltar que", "nĂŁo hĂˇ dĂşvida de que", "nesse sentido", "ademais", "outrossim", "Ă© importante destacar que", "no cenĂˇrio atual", "um aspecto fundamental Ă©", "escusado serĂˇ dizer", "em suma", "Ă© inegĂˇvel que", "diante do exposto"`,
    personalPhrases: `"pela minha experiĂŞncia", "eu mesmo testei isso", "confesso que no comeĂ§oâ€¦", "o que funciona pra mim", "sinceramente"`,
    softStats: `"muitos usuĂˇrios percebem queâ€¦", "pesquisas sugerem queâ€¦", "na prĂˇtica, observa-se queâ€¦"`,
    style: `- Use "vocĂŞ" form (Brazilian informal), NOT "o senhor/a senhora"
- Brazilian Portuguese is naturally warm and conversational â€” embrace it
- Rhetorical questions: "JĂˇ aconteceu com vocĂŞ de...?", "Parece familiar?"
- Avoid excessive anglicisms: use "tela" not "display", "publicaĂ§ĂŁo" not "post"
- Colloquial: "a real Ă© que", "Ăł", "bora lĂˇ", "vamos ser sinceros", "tĂˇ ligado?"
- Use Brazilian expressions naturally: "dĂˇ pra", "tipo assim", "na moral"
- Brazilian readers prefer a light, friendly tone â€” como papo de amigo`,
  },
  ja: {
    name: 'Japanese',
    formalPhrases: `"ćł¨ç›®ă«ĺ€¤ă™ă‚‹", "ç–‘ă„ă®ä˝™ĺś°ăŻăŞă„", "ă“ă®č¦łç‚ąă‹ă‚‰", "ă•ă‚‰ă«", "ĺŠ ăă¦", "ĺĽ·čŞżă™ăąăŤăŻ", "çŹľä»Łç¤ľäĽšă«ăŠă„ă¦", "é‡Ťč¦ăŞĺ´éť˘ăŻ", "č¨€ă†ăľă§ă‚‚ăŞăŹ", "çµč«–ă¨ă—ă¦", "ĺ¦ĺ®šă§ăŤăŞă„äş‹ĺ®źă¨ă—ă¦", "ä»Ąä¸Šă‚’č¸Źăľăă¦"`,
    personalPhrases: `"ç§ă®çµŚé¨“ă§ăŻ", "ĺ®źéš›ă«č©¦ă—ă¦ăżă¦", "ć­Łç›´ă«č¨€ă†ă¨ćś€ĺťăŻâ€¦", "ĺ€‹äşşçš„ă«ă†ăľăŹă„ăŁăźă®ăŻ", "çŽ‡ç›´ă«č¨€ăŁă¦"`,
    softStats: `"ĺ¤šăŹă®ă¦ăĽă‚¶ăĽăŚć„źăă¦ă„ă‚‹ă®ăŻâ€¦", "ç ”ç©¶ăŚç¤şĺ”†ă™ă‚‹ă®ăŻâ€¦", "ĺ®źéš›ă®ă¨ă“ă‚Ťâ€¦"`,
    style: `- Use ă§ă™/ăľă™ form but keep it conversational, not stiff
- Mix in casual expressions: "ĺ®źăŻă­", "ăˇă‚‡ăŁă¨ć„Źĺ¤–ă‹ă‚‚", "ă‚Źă‹ă‚‹ć°—ăŚă™ă‚‹"
- Japanese readers appreciate practical, actionable advice
- Use appropriate particles and sentence-ending forms for friendly tone
- Rhetorical questions: "ă“ă‚“ăŞçµŚé¨“ă‚ă‚Šăľă›ă‚“ă‹ďĽź", "ĺżĺ˝“ăźă‚Šă‚ă‚Šăľă™ă‚ă­ďĽź"
- Break long sentences â€” Japanese AI text tends to create overly complex structures
- Use katakana for established loanwords naturally`,
  },
  'zh-CN': {
    name: 'Simplified Chinese',
    formalPhrases: `"ĺ€Ľĺľ—ćł¨ć„Źçš„ćŻ", "ćŻ«ć— ç–‘é—®", "ä»Žčż™ä¸Şč§’ĺş¦ćťĄçś‹", "ć­¤ĺ¤–", "ä¸Žć­¤ĺŚć—¶", "éś€č¦ĺĽşč°çš„ćŻ", "ĺś¨ĺ˝“ä»Šç¤ľäĽš", "ä¸€ä¸Şĺ…łé”®ć–ąéť˘ćŻ", "ä¸Ťč¨€č€Śĺ–»", "ć€»č€Śč¨€äą‹", "ä¸ŤĺŹŻĺ¦č®¤çš„ćŻ", "ç»Ľä¸Šć‰€čż°"`,
    personalPhrases: `"ć ąćŤ®ć‘çš„ç»ŹéŞŚ", "ć‘äş˛č‡ŞčŻ•čż‡", "čŻ´ĺ®žčŻťä¸€ĺĽ€ĺ§‹â€¦", "ĺŻąć‘ćťĄčŻ´ćś‰ć•çš„ćŻ", "ĺť¦ç™˝čŻ´"`,
    softStats: `"ĺľĺ¤šç”¨ć·ĺŹ‘çŽ°â€¦", "ç ”ç©¶čˇ¨ćŽâ€¦", "ĺ®žé™…ć…ĺ†µćŻâ€¦"`,
    style: `- Use casual but respectful tone â€” ä˝  not ć‚¨ for blog content
- Chinese AI text overuses four-character idioms (ćčŻ­) â€” use sparingly and naturally
- Rhetorical questions: "ä˝ ćś‰ć˛ˇćś‰čż‡čż™ć ·çš„ç»ŹĺŽ†ďĽź", "ćŻä¸ŤćŻĺ¬čµ·ćťĄĺľç†źć‚‰ďĽź"
- Keep sentences shorter than AI typically generates
- Colloquial: "čŻ´çśźçš„", "ä˝ çŚść€Žäąçť€", "é‡Ťç‚ąćťĄäş†", "čŻťčŻ´ĺ›žćťĄ"
- Chinese readers appreciate directness and practical value
- Avoid overly formal or literary register â€” write like a knowledgeable friend`,
  },
  ko: {
    name: 'Korean',
    formalPhrases: `"ěŁĽëŞ©í•  ë§Śí•ś ę˛ěť€", "ěťě‹¬ěť ě—¬ě§€ę°€ ě—†ë‹¤", "ěť´ëź¬í•ś ę´€ě ě—ě„ś", "ëŤ”ë¶ě–´", "ě•„ěš¸ëź¬", "ę°•ěˇ°í•´ě•Ľ í•  ě ěť€", "í„ëŚ€ ě‚¬íšŚě—ě„ś", "í•µě‹¬ě ěť¸ ě¸ˇë©´ěť€", "ë‘ë§í•  ë‚ěś„ ě—†ěť´", "ę˛°ëˇ ě ěśĽëˇś", "ë¶€ěť¸í•  ě ě—†ëŠ” ě‚¬ě‹¤ěť€", "ěť´ěěť„ ě˘…í•©í•ë©´"`,
    personalPhrases: `"ě ś ę˛˝í—ě", "ě§ě ‘ í•´ë´¤ëŠ”ëŤ°", "ě†”ě§íž ě˛ěťŚě—ëŠ”â€¦", "ě €í•śí…Ś íš¨ęłĽę°€ ěžě—ëŤ ę±´", "ě†”ě§íž ë§í•ë©´"`,
    softStats: `"ë§Žěť€ ě‚¬ěš©ěžë“¤ěť´ ëŠëĽëŠ” ę±´â€¦", "ě—°ęµ¬ě— ë”°ëĄ´ë©´â€¦", "ě‹¤ě śëˇś ëł´ë©´â€¦"`,
    style: `- Use í•´ěš”ě˛´ (polite informal) â€” not í•©ë‹ë‹¤ě˛´ (formal) for blog
- Korean AI text tends to be overly formal â€” make it conversational
- Rhetorical questions: "ěť´ëź° ę˛˝í— ěžěśĽě‹śěŁ ?", "ęłµę°ëě‹śë‚ěš”?"
- Colloquial: "ě‚¬ě‹¤ěť€ěš”", "ę·ĽëŤ° ë§ěť´ě—ěš”", "í•µě‹¬ěť€ěš”", "ě†”ě§íž"
- Korean readers appreciate relatable, empathetic content
- Mix honorific levels naturally â€” slight informality builds trust
- Avoid direct translation patterns from English word order`,
  },
  tr: {
    name: 'Turkish',
    formalPhrases: `"belirtmek gerekir ki", "ĹźĂĽphesiz ki", "bu baÄźlamda", "ayrÄ±ca", "bunun yanÄ± sÄ±ra", "vurgulanmasÄ± gereken", "gĂĽnĂĽmĂĽz dĂĽnyasÄ±nda", "temel bir husus", "sĂ¶ylemeye gerek yok ki", "sonuĂ§ olarak", "yadsÄ±namaz bir gerĂ§ektir ki", "yukarÄ±da belirtildiÄźi ĂĽzere"`,
    personalPhrases: `"kendi deneyimimden", "bunu bizzat denedim", "itiraf edeyim baĹźtaâ€¦", "benim iĂ§in iĹźe yarayan", "aĂ§Ä±kĂ§asÄ±"`,
    softStats: `"birĂ§ok kullanÄ±cÄ± fark ediyor kiâ€¦", "araĹźtÄ±rmalar gĂ¶steriyor kiâ€¦", "pratikte gĂ¶zlemlenenâ€¦"`,
    style: `- Use "sen" form (informal), NOT "siz" for blog content
- Turkish agglutinative structure â€” avoid overly long compound words
- Rhetorical questions: "HiĂ§ baĹźÄ±na geldi mi?", "TanÄ±dÄ±k geldi mi?"
- Colloquial: "aĂ§Ä±kĂ§asÄ±", "iĹźin aslÄ±", "asÄ±l mesele Ĺźu ki", "dĂĽrĂĽst olalÄ±m"
- Turkish readers appreciate direct, honest communication
- Vary sentence endings â€” don't always end with -dÄ±r/-dir
- Use natural Turkish idioms: "iĹźin pĂĽf noktasÄ±", "can alÄ±cÄ± nokta"`,
  },
  ru: {
    name: 'Russian',
    formalPhrases: `"ŃŃ‚ĐľĐ¸Ń‚ ĐľŃ‚ĐĽĐµŃ‚Đ¸Ń‚ŃŚ, Ń‡Ń‚Đľ", "Đ˝Đµ Đ˛Ń‹Đ·Ń‹Đ˛Đ°ĐµŃ‚ ŃĐľĐĽĐ˝ĐµĐ˝Đ¸Đą", "Đ˛ Đ´Đ°Đ˝Đ˝ĐľĐĽ ĐşĐľĐ˝Ń‚ĐµĐşŃŃ‚Đµ", "ĐşŃ€ĐľĐĽĐµ Ń‚ĐľĐłĐľ", "ĐżĐľĐĽĐ¸ĐĽĐľ ŃŤŃ‚ĐľĐłĐľ", "Đ˝ĐµĐľĐ±Ń…ĐľĐ´Đ¸ĐĽĐľ ĐżĐľĐ´Ń‡ĐµŃ€ĐşĐ˝ŃŃ‚ŃŚ", "Đ˛ ŃĐľĐ˛Ń€ĐµĐĽĐµĐ˝Đ˝ĐľĐĽ ĐĽĐ¸Ń€Đµ", "ĐşĐ»ŃŽŃ‡ĐµĐ˛Ń‹ĐĽ Đ°ŃĐżĐµĐşŃ‚ĐľĐĽ ŃŹĐ˛Đ»ŃŹĐµŃ‚ŃŃŹ", "ŃĐ°ĐĽĐľ ŃĐľĐ±ĐľĐą Ń€Đ°Đ·ŃĐĽĐµĐµŃ‚ŃŃŹ", "Đ˛ Đ·Đ°ĐşĐ»ŃŽŃ‡ĐµĐ˝Đ¸Đµ", "Đ˝ĐµĐľŃĐżĐľŃ€Đ¸ĐĽŃ‹ĐĽ Ń„Đ°ĐşŃ‚ĐľĐĽ ŃŹĐ˛Đ»ŃŹĐµŃ‚ŃŃŹ", "Đ˝Đ° ĐľŃĐ˝ĐľĐ˛Đ°Đ˝Đ¸Đ¸ Đ˛Ń‹ŃĐµĐ¸Đ·Đ»ĐľĐ¶ĐµĐ˝Đ˝ĐľĐłĐľ"`,
    personalPhrases: `"ĐżĐľ ĐĽĐľĐµĐĽŃ ĐľĐżŃ‹Ń‚Ń", "ŃŹ ŃĐ°ĐĽ ŃŤŃ‚Đľ ĐżŃ€ĐľĐ±ĐľĐ˛Đ°Đ»", "ĐżŃ€Đ¸Đ·Đ˝Đ°ŃŽŃŃŚ, ĐżĐľĐ˝Đ°Ń‡Đ°Đ»Ńâ€¦", "ĐĽĐ˝Đµ ĐżĐľĐĽĐľĐłĐ°ĐµŃ‚", "Ń‡ĐµŃŃ‚Đ˝Đľ ĐłĐľĐ˛ĐľŃ€ŃŹ"`,
    softStats: `"ĐĽĐ˝ĐľĐłĐ¸Đµ ĐżĐľĐ»ŃŚĐ·ĐľĐ˛Đ°Ń‚ĐµĐ»Đ¸ Đ·Đ°ĐĽĐµŃ‡Đ°ŃŽŃ‚, Ń‡Ń‚Đľâ€¦", "Đ¸ŃŃĐ»ĐµĐ´ĐľĐ˛Đ°Đ˝Đ¸ŃŹ ĐżĐľĐşĐ°Đ·Ń‹Đ˛Đ°ŃŽŃ‚, Ń‡Ń‚Đľâ€¦", "Đ˝Đ° ĐżŃ€Đ°ĐşŃ‚Đ¸ĐşĐµ Đ˛Đ¸Đ´Đ˝Đľ, Ń‡Ń‚Đľâ€¦"`,
    style: `- Use "Ń‚Ń‹" form (informal), NOT "Đ’Ń‹" for blog content
- Russian AI text overuses official/bureaucratic style â€” make it Đ¶Đ¸Đ˛ĐľĐą (alive)
- Rhetorical questions: "Đ—Đ˝Đ°ĐşĐľĐĽĐľ?", "Đ‘Ń‹Đ˛Đ°Đ»Đľ Ń‚Đ°ĐşĐľĐµ?", "ĐŁĐ·Đ˝Đ°Ń‘ŃŃŚ ŃĐµĐ±ŃŹ?"
- Colloquial: "Đ˝Đ° ŃĐ°ĐĽĐľĐĽ Đ´ĐµĐ»Đµ", "Đ˛ĐľŃ‚ Đ˛ Ń‡Ń‘ĐĽ Ń„Đ¸ŃĐşĐ°", "Đ´Đ°Đ˛Đ°Đą Ń‡ĐµŃŃ‚Đ˝Đľ", "ŃŃŃ‚ŃŚ Đ˛ Ń‚ĐľĐĽ, Ń‡Ń‚Đľ"
- Russian readers appreciate depth and sincerity â€” don't be superficial
- Use natural Russian word order â€” freer than English, use for emphasis
- Avoid ĐşĐ°Đ˝Ń†ĐµĐ»ŃŹŃ€Đ¸Ń‚ (bureaucratic language) â€” it's the biggest AI giveaway in Russian`,
  },
};

async function doHumanize(markdown, lang) {
  const lg = LANG_GUIDELINES[lang] || LANG_GUIDELINES.en;
  console.log(`[AI Humanize] Processing ${markdown?.length || 0} chars in ${lg.name}`);

  const result = await callClaude(
    `You are an experienced ${lg.name}-language editor who humanizes AI-generated content. Write ENTIRELY in ${lg.name}. Your task is to transform the given text so it sounds like it was written by a real person â€” a ${lg.name}-speaking expert who blogs with passion, not a robot producing content.`,
    `STEP 1: DIAGNOSE â€” Before editing, analyze the article and list 5-7 specific AI-pattern problems you found (with quotes from the text). Output them as a brief numbered list at the very top, wrapped in <!-- DIAGNOSIS: ... --> HTML comment. Write the diagnosis in ${lg.name}.

STEP 2: FIX â€” Then output the fully rewritten article applying ALL fixes below.

## 1. STRUCTURE & RHYTHM
- Vary paragraph lengths (mix: 1-sentence, 3-sentence, 5-sentence)
- Vary sentence lengths (mix short punchy with longer complex ones)
- Break the perfect symmetry of sections â€” not every section should have exactly 3 paragraphs
- Add 1-2 single-sentence paragraphs for dramatic effect
- Remove or relocate duplicate information (AI often repeats the same data in different sections)
- If a list has only 3 items, convert it to a flowing sentence instead

## 2. VOICE & PERSONALITY (${lg.name}-specific rules)
- Add 2-3 personal interjections using natural ${lg.name} phrasing: ${lg.personalPhrases}
- Insert 1 controversial opinion or caveat
- Add 1-2 rhetorical questions directed at the reader
- Insert 1 colloquial/informal expression natural to ${lg.name}
- REMOVE these ${lg.name} AI-filler/formal phrases (AI overuses them): ${lg.formalPhrases}
- Add 1 brief digression or anecdote (even 2 sentences) â€” this is the most human element
- LANGUAGE-SPECIFIC STYLE RULES:
${lg.style}

## 3. FORMATTING (anti-AI)
- Reduce bolds â€” max 3-4 per 1000 words (AI overuses bold)
- Don't bold every other paragraph â€” bold should be the exception
- Don't start every section with a defining sentence ("X is a technique thatâ€¦")
- Vary how paragraphs open (don't start from the same pattern)
- Don't end every section with a CTA or summary

## 4. DATA & SOURCES
- Max 3-4 statistics in the ENTIRE article â€” replace the rest with soft ${lg.name} observations: ${lg.softStats}
- Add context to statistics ("this 2022 studyâ€¦", "though the numbers may vary")
- Don't drop stats without commentary â€” add an interpreting sentence
- When studies are mentioned without links, add real external source links (WHO, PubMed, university domains)

## 5. INTERNAL LINKS / PRODUCT
- Max 2-3 product mentions in the entire article
- Product mentions should arise from context, not be forced
- Don't start or end the article with product promotion

## 6. KEYWORDS (anti-stuffing)
- Check if the main keyword appears more than 5-7 times per 2000 words â€” if so, replace excess with ${lg.name} synonyms
- Use natural ${lg.name} synonym variants for the main keyword
- Keywords should sound natural in the sentence â€” if grammar bends to fit the phrase, rewrite it

## 7. INTRO & OUTRO
- Intro should NOT be encyclopedic â€” if it starts with a definition, rewrite to start from the reader's problem, a question, or brief story
- Outro should NOT be a formulaic summary â€” end with a concrete takeaway, call to action, or reflection

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

// â”€â”€â”€ AI: Humanize article (remove AI patterns) â”€â”€â”€
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

// â”€â”€â”€ Helper: Audit article â”€â”€â”€
async function doAudit(markdown, lang) {
  const langName = getLangName(lang);
  console.log(`[AI Audit] Analyzing ${markdown?.length || 0} chars in ${langName}`);

  const result = await callClaude(
    `You analyze blog articles for "AI fingerprints" â€” typical traits of AI-generated content that reduce reader trust and may trigger Google's Helpful Content Update penalties. Respond in ${langName}.`,
    `Analyze this blog article for AI-generated content patterns. Score it 1-10 (1 = fully human, 10 = obvious AI) and justify your assessment.

CHECK THESE 10 DIMENSIONS (score each 1-10):
1. Structure symmetry â€” do sections have identical structure/length?
2. Data/fact repetition â€” same stats repeated in different sections?
3. Bold overuse â€” bolded terms in almost every paragraph?
4. Lack of personal voice â€” no anecdotes, opinions, digressions?
5. Formulaic phrases â€” "it's worth noting", "a key aspect", "furthermore"?
6. Stats in every section â€” data dumping without interpretation?
7. No controversy or caveats â€” everything presented as universally true?
8. Encyclopedic intro â€” starts with a definition instead of a problem?
9. Formulaic outro â€” "In summaryâ€¦", "To concludeâ€¦"?
10. Keyword stuffing â€” main keyword appearing every 100 words?

RESPONSE FORMAT (use exactly this JSON structure):
{
  "score": 7,
  "dimensions": [
    { "name": "Structure symmetry", "score": 8, "detail": "All 5 sections follow identical pattern: definition â†’ 3 paragraphs â†’ stat" },
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

// â”€â”€â”€ AI: Audit article for AI fingerprints â”€â”€â”€
app.post('/api/ai/audit', async (req, res) => {
  const { markdown, lang } = req.body;
  try {
    res.json(await doAudit(markdown, lang));
  } catch (err) {
    console.error(`[AI Audit] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Helper: Full grammar fix (LanguageTool + AI) â”€â”€â”€
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
    `${idx+1}. Find: "${i.context.trim()}" â†’ Replace with suggestion: "${i.suggestion}". Reason: ${i.message}`
  );
  const otherIssues = issues.filter(i => !i.suggestion || !i.suggestion.trim()).map((i, idx) =>
    `${idx+1}. Issue near: "${i.context.trim()}" â€” ${i.message}`
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
- Add missing periods after abbreviations (Pon. Wt. Ĺšr. Czw. Pt.).
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

// â”€â”€â”€ AI: Fix grammar & readability â”€â”€â”€
app.post('/api/ai/fix-grammar', async (req, res) => {
  const { markdown, issues, lang } = req.body;
  const langName = getLangName(lang);

  // Build actionable issue list â€” only include issues with concrete suggestions
  const actionableIssues = (issues || []).filter(i => i.suggestion && i.suggestion.trim()).map((i, idx) =>
    `${idx+1}. Find: "${i.context.trim()}" â†’ Replace with suggestion: "${i.suggestion}". Reason: ${i.message}`
  );
  const otherIssues = (issues || []).filter(i => !i.suggestion || !i.suggestion.trim()).map((i, idx) =>
    `${idx+1}. Issue near: "${i.context.trim()}" â€” ${i.message}`
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
- Add missing periods after abbreviations (Pon. Wt. Ĺšr. Czw. Pt.).
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

// â”€â”€â”€ AI: Expand a section â”€â”€â”€
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

// â”€â”€â”€ AI: Improve SEO â”€â”€â”€
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

// â”€â”€â”€ AI: Internal Linking Suggestions â”€â”€â”€
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
      `Find phrases in this article that naturally match other articles on the site. Each phrase should be an existing substring in the article text â€” do NOT invent phrases.

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

// â”€â”€â”€ AI: Create localized version of article â”€â”€â”€
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

// â”€â”€â”€ Helpers â”€â”€â”€
function findArticleFile(lang, slug) {
  if (!isValidLang(lang) || !isValidSlug(slug)) return null;
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

// â”€â”€â”€ SEO Analyzer â”€â”€â”€
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
    hint: titleLen < 40 ? 'Too short â€” add more descriptive words' : titleLen > 65 ? 'Too long â€” trim to ~60 chars' : 'Good'
  });

  // Meta description
  const descLen = desc.length;
  checks.push({
    id: 'desc-length',
    label: 'Meta description (120-160 chars)',
    value: descLen,
    pass: descLen >= 100 && descLen <= 165,
    hint: descLen < 100 ? 'Too short â€” expand the summary' : descLen > 165 ? 'Too long â€” will be truncated in SERP' : 'Good'
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
    hint: questionH2s.length === 0 ? 'Rephrase at least one H2 as a question' : 'Good â€” helps with featured snippets'
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

// â”€â”€â”€ Readability Analyzer â”€â”€â”€
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
      ...(veryLongSentences.length ? [`${veryLongSentences.length} very long sentences (40+ words) â€” consider splitting`] : []),
      ...(longSentences.length > 3 ? [`${longSentences.length} long sentences (25+ words)`] : []),
      ...(longParagraphs.length ? [`${longParagraphs.length} paragraphs over 100 words â€” break them up`] : []),
      ...(flesch < 40 ? ['Text is hard to read â€” simplify vocabulary and shorten sentences'] : [])
    ]
  };
}

function countSyllables(word, lang) {
  // Simple heuristic â€” works reasonably for PL/EN
  word = word.toLowerCase().replace(/[^a-zÄ…Ä‡Ä™Ĺ‚Ĺ„ĂłĹ›ĹşĹĽĂ¤Ă¶ĂĽĂźĂ Ă˘Ă©Ă¨ĂŞĂ«ĂŻĂ®Ă´ĂąĂ»ĂĽĂ§]/g, '');
  if (word.length <= 3) return 1;
  // Count vowel groups
  const vowels = lang === 'pl' ? /[aeiouyÄ…Ä™Ăł]+/gi : /[aeiouy]+/gi;
  const matches = word.match(vowels);
  return matches ? Math.max(1, matches.length) : 1;
}

// â”€â”€â”€ Auto-sync article focus keyword â†’ tracked keywords â”€â”€â”€
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

// â”€â”€â”€ Keyword Rank Tracker â”€â”€â”€

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
    { keyword: 'Ä‡wiczenia dla oczu', lang: 'pl', targetUrl: 'https://healthdesk.site/pl/', targetPage: 'pl/landing' },
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

// API: Site structure â€” all pages with their SEO data
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
      console.log(`[Rank] "${kw.keyword}": position ${foundPosition || 'not found'}${cannibalization ? ' âš ď¸Ź CANNIBALIZATION' : ''}`);

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
          ? `Strona ${latest.foundUrl} rankuje zamiast ${kw.targetUrl}. RozwaĹĽ canonical lub zmianÄ™ treĹ›ci.`
          : `Kilka stron rankuje na to samo keyword. RozwaĹĽ konsolidacjÄ™.`
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

// â”€â”€â”€ AI: Generate hero image (Gemini Nano Banana â†’ WebP) â”€â”€â”€
const BLOG_IMAGES_DIR = path.join(LANDING_ROOT, 'src', 'content', 'images', 'blog');

function getGeminiKey() {
  const studio = readJsonFile(STUDIO_DATA, {});
  return studio.gemini_api_key || process.env.GEMINI_API_KEY || null;
}

// â”€â”€â”€ Helper: Validate post completeness â”€â”€â”€
function validatePost(slug, lang) {
  const issues = [];
  const mdFile = path.join(BLOG_DIR, lang, `${slug}.md`);
  const imgFile = path.join(BLOG_IMAGES_DIR, `${slug}.webp`);

  // Check .md exists
  if (!fs.existsSync(mdFile)) {
    issues.push({ field: 'file', message: 'Markdown file missing' });
    return { valid: false, issues };
  }

  const content = fs.readFileSync(mdFile, 'utf8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    issues.push({ field: 'frontmatter', message: 'No frontmatter block found' });
    return { valid: false, issues };
  }

  const fm = fmMatch[1];
  // Required frontmatter fields
  for (const field of ['title', 'slug', 'description', 'keyword', 'date', 'lang']) {
    if (!new RegExp(`^${field}:`, 'm').test(fm)) {
      issues.push({ field, message: `Missing frontmatter field: ${field}` });
    }
  }

  const slugMatch = fm.match(/^slug:\s*["']?([^"'\n]*)["']?\s*$/m);
  const frontmatterSlug = slugMatch?.[1]?.trim() || '';
  if (!frontmatterSlug) {
    issues.push({ field: 'slug', message: 'Slug is empty' });
  } else if (isSuspiciousSlug(frontmatterSlug)) {
    issues.push({ field: 'slug', message: 'Slug is suspicious or not SEO-safe' });
  }

  // Check hero image
  if (!fs.existsSync(imgFile)) {
    issues.push({ field: 'heroImage', message: 'Hero image .webp missing' });
  }

  // Check content length (body after frontmatter)
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  if (body.length < 500) {
    issues.push({ field: 'content', message: `Content too short (${body.length} chars, min 500)` });
  }

  if (hasBrokenEncoding(fm)) {
    issues.push({ field: 'frontmatter', message: 'Frontmatter appears to contain broken text encoding' });
  }
  if (hasBrokenEncoding(body.slice(0, 4000))) {
    issues.push({ field: 'content', message: 'Content appears to contain broken text encoding' });
  }

  return { valid: issues.length === 0, issues };
}

// â”€â”€â”€ Helper: Image regeneration queue â”€â”€â”€
const REGEN_QUEUE_PATH = path.join(__dirname, 'image_regen_queue.json');

function loadRegenQueue() {
  try { return JSON.parse(fs.readFileSync(REGEN_QUEUE_PATH, 'utf-8')); }
  catch { return []; }
}

function saveRegenQueue(queue) {
  fs.writeFileSync(REGEN_QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
}

function addToRegenQueue(slug, lang, reason) {
  const queue = loadRegenQueue();
  if (queue.find(q => q.slug === slug && q.lang === lang)) return; // already queued
  queue.push({ slug, lang, reason, added: new Date().toISOString() });
  saveRegenQueue(queue);
  console.log(`[RegenQueue] Added ${lang}/${slug}: ${reason}`);
}

// â”€â”€â”€ Helper: Generate hero image â”€â”€â”€
async function doHeroImage(slug, lang, title, description, style) {
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error('No Gemini API key configured. Add gemini_api_key to studio.json');

  const langName = getLangName(lang);
  const styleHint = style || 'clean, modern, professional';

  // Cultural context for localized imagery
  const culturalContext = {
    'pl': 'Polish/Central European setting â€” Polish-looking people, European office style, subtle Polish cultural elements',
    'en': 'International/Western setting â€” diverse people, modern Western-style office or home office',
    'de': 'German/DACH setting â€” German-looking people, orderly German-style workspace, subtle German cultural elements',
    'es': 'Spanish/Latin setting â€” Hispanic/Latino people, warm Mediterranean or Latin American office atmosphere',
    'fr': 'French setting â€” French-looking people, elegant Parisian-style workspace, subtle French cultural touches',
    'it': 'Italian setting â€” Italian-looking people, stylish Italian workspace, warm Mediterranean atmosphere',
    'pt-BR': 'Brazilian setting â€” Brazilian/mixed-race people, tropical or modern Brazilian office, warm vibrant atmosphere',
    'ja': 'Japanese setting â€” Japanese people, minimalist Japanese-style workspace, subtle Japanese cultural elements (bonsai, shoji, tatami)',
    'zh-CN': 'Chinese setting â€” Chinese people, modern Chinese office or home, subtle Chinese cultural elements (tea, calligraphy, bamboo)',
    'ko': 'Korean setting â€” Korean people, modern Korean-style workspace, subtle Korean cultural elements (hanok influence, clean aesthetics)',
    'tr': 'Turkish setting â€” Turkish people, Turkish office environment, subtle Turkish cultural elements (tea, kilim patterns)',
    'ru': 'Russian setting â€” Russian-looking people, Russian office or home office, subtle Russian cultural touches'
  };
  const cultureHint = culturalContext[lang] || 'International setting';

  const imagePrompt = `Generate a photorealistic hero image for a blog article.

Article: "${title}"
Description: ${description}
Style: ${styleHint}

Cultural context: ${cultureHint}

Requirements:
- Photorealistic or high-quality illustration, landscape orientation (16:9)
- Related to workplace health, wellness, productivity, or ergonomics
- Reflect the cultural context: show people and environment matching the target audience's ethnicity and culture
- ${['ja', 'zh-CN', 'ko', 'ru'].includes(lang) ? 'Do NOT include any text, letters, words, signs, labels, or writing anywhere in the image â€” text in non-Latin scripts renders poorly' : `If any decorative text or signage appears naturally in the scene, use ${langName} language`}
- When showing people: use natural, candid angles â€” over-the-shoulder, from behind, hands close-up, or wide environmental shots where the person is part of the scene. NEVER crop or hide the head unnaturally. It is OK to show the back of someone's head, a side profile, or a person seen from a distance. The goal is a natural photo, not a faceless mannequin.
- Prefer showing objects, workspaces, or hands-on-keyboard scenes when people are not essential to the image
- Good contrast, visually striking for a blog header and og:image
- Warm, inviting atmosphere with natural lighting

After generating the image, write a single line of SEO alt text (max 125 characters) in ${langName} describing what the image shows. Format: ALT: <your alt text>`;

  const MAX_RETRIES = 3;
  let imageBase64 = null;
  let imageMime = null;
  let altText = title;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Image] Calling Gemini 3.1 Flash Image for "${title}" (attempt ${attempt}/${MAX_RETRIES})...`);
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

      if (!imageBase64) throw new Error('Gemini did not return an image');
      break; // success
    } catch (err) {
      lastError = err;
      console.error(`[Image] Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 3000;
        console.log(`[Image] Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  if (!imageBase64) throw new Error(`Hero image failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);

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
  if (!isValidWebp(req.params.filename)) return res.status(400).send('Invalid filename');
  const filepath = path.join(BLOG_IMAGES_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
  res.type('image/webp').sendFile(filepath);
});

// Check if hero image exists for a slug
app.get('/api/hero-image/:slug', (req, res) => {
  if (!isValidSlug(req.params.slug)) return res.status(400).json({ error: 'Invalid slug' });
  const filename = `${req.params.slug}.webp`;
  const filepath = path.join(BLOG_IMAGES_DIR, filename);
  if (!fs.existsSync(filepath)) return res.json({ exists: false });
  const stats = fs.statSync(filepath);
  res.json({ exists: true, filename, path: `/images/blog/${filename}`, size: `${(stats.size / 1024).toFixed(1)} KB` });
});

// Delete hero image
app.delete('/api/hero-image/:slug', (req, res) => {
  if (!isValidSlug(req.params.slug)) return res.status(400).json({ error: 'Invalid slug' });
  const filepath = path.join(BLOG_IMAGES_DIR, `${req.params.slug}.webp`);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  res.json({ ok: true });
});

// Image regeneration queue API
app.get('/api/image-regen-queue', (req, res) => {
  res.json(loadRegenQueue());
});

app.post('/api/image-regen-queue', (req, res) => {
  const { slug, lang, reason } = req.body;
  if (!isValidSlug(slug) || !isValidLang(lang)) return res.status(400).json({ error: 'Invalid slug or lang' });
  addToRegenQueue(slug, lang, reason || 'manual request');
  res.json({ ok: true, queue: loadRegenQueue() });
});

app.delete('/api/image-regen-queue/:slug', (req, res) => {
  const queue = loadRegenQueue().filter(q => q.slug !== req.params.slug);
  saveRegenQueue(queue);
  res.json({ ok: true, queue });
});

// â”€â”€â”€ GSC Indexing â”€â”€â”€
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

function getSitemapLastmod(url) {
  return parseSitemapUrls().find(entry => entry.url === url)?.lastmod || null;
}

function updateGscCacheEntry(url, lastmod = null, notifiedAt = null) {
  const cache = loadGscCache();
  cache[url] = {
    notifiedAt: notifiedAt || new Date().toISOString(),
    lastmod: lastmod || getSitemapLastmod(url)
  };
  saveGscCache(cache);
}

async function submitUrlToGsc(url) {
  if (!fs.existsSync(GSC_KEY_PATH)) return { ok: false, skipped: true };
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: GSC_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/indexing']
  });
  const indexing = google.indexing({ version: 'v3', auth });
  await indexing.urlNotifications.publish({ requestBody: { url, type: 'URL_UPDATED' } });
  updateGscCacheEntry(url);
  return { ok: true };
}

async function resubmitSitemapToGsc(force = false) {
  if (!fs.existsSync(GSC_KEY_PATH)) return { ok: false, skipped: true };

  const statePath = path.join(__dirname, '.sitemap-resubmit.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf-8')); } catch {}

  if (!force && state.lastResubmit) {
    const hoursSince = (Date.now() - new Date(state.lastResubmit).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 12) return { ok: true, skipped: true };
  }

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: GSC_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/webmasters']
  });
  const wm = google.webmasters({ version: 'v3', auth });
  await wm.sitemaps.submit({
    siteUrl: SITE_URL_GSC,
    feedpath: 'https://healthdesk.site/sitemap.xml'
  });

  state.lastResubmit = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  return { ok: true };
}

// API: GSC status â€” show all URLs with indexing status
app.get('/api/gsc/status', (req, res) => {
  const hasKey = fs.existsSync(GSC_KEY_PATH);
  const hasSitemap = fs.existsSync(SITEMAP_PATH_GSC);
  if (!hasKey) return res.json({ configured: false, error: 'Brak gsc-key.json' });
  if (!hasSitemap) return res.json({ configured: true, error: 'Brak dist/sitemap.xml â€” uruchom Build' });

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

// API: GSC submit â€” send URLs to Google Indexing API
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

// â”€â”€â”€ GSC URL Inspection â”€â”€â”€

app.get('/api/gsc/inspect', async (req, res) => {
  if (!fs.existsSync(GSC_KEY_PATH)) return res.json({ error: 'No GSC key' });

  try {
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      keyFile: GSC_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
    });
    const searchconsole = google.searchconsole({ version: 'v1', auth });
    const sitemapUrls = parseSitemapUrls().map(u => u.url);

    const results = [];
    for (const url of sitemapUrls) {
      try {
        const r = await searchconsole.urlInspection.index.inspect({
          requestBody: { inspectionUrl: url, siteUrl: SITE_URL_GSC }
        });
        const ir = r.data.inspectionResult?.indexStatusResult || {};
        results.push({
          url,
          verdict: ir.verdict || 'UNKNOWN',
          coverageState: ir.coverageState || '',
          robotsTxtState: ir.robotsTxtState || '',
          lastCrawlTime: ir.lastCrawlTime || null
        });
      } catch (e) {
        results.push({ url, verdict: 'ERROR', coverageState: e.message });
      }
      // Rate limit: 600 req/min for URL Inspection API
      await new Promise(r => setTimeout(r, 200));
    }

    const indexed = results.filter(r => r.verdict === 'PASS');
    const notIndexed = results.filter(r => r.verdict !== 'PASS' && r.verdict !== 'ERROR');
    const errors = results.filter(r => r.verdict === 'ERROR');

    res.json({
      total: results.length,
      indexed: indexed.length,
      not_indexed: notIndexed.length,
      errors: errors.length,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ GSC Search Analytics â”€â”€â”€

function getGscAuth() {
  const { google } = require('googleapis');
  return new google.auth.GoogleAuth({
    keyFile: GSC_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
  });
}

// API: GSC Analytics â€” performance data (queries, pages, clicks, impressions, position)
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

    res.json({ configured: true, rows, period: `${startDate.toISOString().slice(0, 10)} â€” ${endDate.toISOString().slice(0, 10)}` });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[GSC Analytics]', msg);
    res.json({ configured: true, rows: [], error: msg });
  }
});

// API: GSC Analytics â€” daily trend for specific query or page
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

// API: GSC Analytics â€” discover new keywords not yet tracked
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

// â”€â”€â”€ GA4 Analytics â”€â”€â”€

const GA4_PROPERTY = 'properties/526378138';

async function fetchGA4Data(days = 30) {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: GSC_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly']
  });
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth });

  const [overview, pages, sources] = await Promise.all([
    analyticsdata.properties.runReport({
      property: GA4_PROPERTY,
      requestBody: {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        metrics: [
          { name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' },
          { name: 'averageSessionDuration' }, { name: 'bounceRate' }
        ]
      }
    }),
    analyticsdata.properties.runReport({
      property: GA4_PROPERTY,
      requestBody: {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 20
      }
    }),
    analyticsdata.properties.runReport({
      property: GA4_PROPERTY,
      requestBody: {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
      }
    })
  ]);

  const vals = overview.data.rows?.[0]?.metricValues || [];
  return {
    period: `${days} dni`,
    overview: {
      sessions: parseInt(vals[0]?.value || 0),
      users: parseInt(vals[1]?.value || 0),
      pageviews: parseInt(vals[2]?.value || 0),
      avg_session_duration: Math.round(parseFloat(vals[3]?.value || 0)),
      bounce_rate: Math.round(parseFloat(vals[4]?.value || 0) * 1000) / 10
    },
    top_pages: (pages.data.rows || []).map(r => ({
      path: r.dimensionValues[0].value,
      views: parseInt(r.metricValues[0].value),
      users: parseInt(r.metricValues[1].value),
      bounce_rate: Math.round(parseFloat(r.metricValues[2].value || 0) * 1000) / 10
    })),
    sources: (sources.data.rows || []).map(r => ({
      channel: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value),
      users: parseInt(r.metricValues[1].value)
    }))
  };
}

app.get('/api/ga4/overview', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      keyFile: GSC_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly']
    });
    const analyticsdata = google.analyticsdata({ version: 'v1beta', auth });
    const days = parseInt(req.query.days) || 30;

    const [overview, pages, sources] = await Promise.all([
      analyticsdata.properties.runReport({
        property: GA4_PROPERTY,
        requestBody: {
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
          metrics: [
            { name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' },
            { name: 'averageSessionDuration' }, { name: 'bounceRate' }
          ]
        }
      }),
      analyticsdata.properties.runReport({
        property: GA4_PROPERTY,
        requestBody: {
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 20
        }
      }),
      analyticsdata.properties.runReport({
        property: GA4_PROPERTY,
        requestBody: {
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
        }
      })
    ]);

    const vals = overview.data.rows?.[0]?.metricValues || [];
    res.json({
      period: `${days} dni`,
      overview: {
        sessions: parseInt(vals[0]?.value || 0),
        users: parseInt(vals[1]?.value || 0),
        pageviews: parseInt(vals[2]?.value || 0),
        avg_session_duration: Math.round(parseFloat(vals[3]?.value || 0)),
        bounce_rate: Math.round(parseFloat(vals[4]?.value || 0) * 1000) / 10
      },
      top_pages: (pages.data.rows || []).map(r => ({
        path: r.dimensionValues[0].value,
        views: parseInt(r.metricValues[0].value),
        users: parseInt(r.metricValues[1].value)
      })),
      sources: (sources.data.rows || []).map(r => ({
        channel: r.dimensionValues[0].value,
        sessions: parseInt(r.metricValues[0].value),
        users: parseInt(r.metricValues[1].value)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Insights: GSC Opportunities â”€â”€â”€

const INSIGHTS_PATH = path.join(__dirname, 'insights.json');

function loadInsights() {
  try { return JSON.parse(fs.readFileSync(INSIGHTS_PATH, 'utf-8')); }
  catch { return { entries: [] }; }
}
function saveInsights(data) {
  fs.writeFileSync(INSIGHTS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

async function runOpportunitiesAnalysis() {
  if (!fs.existsSync(GSC_KEY_PATH)) return [];

  const { google } = require('googleapis');
  const auth = getGscAuth();
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  const result = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL_GSC,
    requestBody: {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      dimensions: ['query', 'page'],
      rowLimit: 500
    }
  });

  const rows = result.data.rows || [];
  const studio = loadStudioData();
  const articles = studio.articles || {};

  // Build article URL -> key map
  const urlToArticle = {};
  for (const [key, art] of Object.entries(articles)) {
    const [lang, slug] = key.split('/');
    const url = `https://healthdesk.site/${lang}/blog/${slug}/`;
    urlToArticle[url] = { key, lang, slug, title: art.title || key, status: art.status };
  }

  // Collect existing blog keywords
  const existingKeywords = new Set();
  for (const cl of (studio.content_calendar?.clusters || [])) {
    for (const [lang, kws] of Object.entries(cl.keywords || {})) {
      for (const k of kws) {
        existingKeywords.add(k.keyword.toLowerCase());
      }
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const opportunities = [];

  for (const row of rows) {
    const query = row.keys[0];
    const page = row.keys[1];
    const pos = Math.round(row.position * 10) / 10;
    const imp = row.impressions;
    const clk = row.clicks;
    const ctr = Math.round((row.ctr || 0) * 1000) / 10;

    // Low-hanging fruit: position 5-50, some impressions, low CTR
    if (pos < 5 || pos > 50 || imp < 2) continue;

    const matched = urlToArticle[page] || null;
    const isNewKeyword = !existingKeywords.has(query.toLowerCase());

    let type, priority, suggestion;

    if (matched && pos <= 20) {
      type = 'improve';
      priority = pos <= 10 ? 'high' : 'medium';
      suggestion = pos <= 10
        ? `Post "${matched.title}" na pozycji ${pos} â€” blisko top 10. Rozbuduj treĹ›Ä‡, dodaj FAQ, wzmocnij nagĹ‚Ăłwki.`
        : `Post "${matched.title}" na pozycji ${pos}. Dodaj sekcjÄ™ o "${query}", rozbuduj do 2000+ sĹ‚Ăłw.`;
    } else if (matched && pos > 20) {
      type = 'improve';
      priority = 'low';
      suggestion = `Post "${matched.title}" na pozycji ${pos}. Daleko od top 10 â€” rozwaĹĽ nowy, lepiej zoptymalizowany post.`;
    } else if (isNewKeyword) {
      type = 'new-keyword';
      priority = imp >= 10 ? 'high' : imp >= 5 ? 'medium' : 'low';
      suggestion = `Nowa fraza "${query}" â€” ${imp} impresji, nie mamy posta. Dodaj do kalendarza.`;
    } else {
      type = 'opportunity';
      priority = 'low';
      suggestion = `Fraza "${query}" jest w kalendarzu ale post jeszcze nie napisany.`;
    }

    opportunities.push({
      id: `opp-${Date.now()}-${opportunities.length}`,
      date: today,
      type, query, position: pos, impressions: imp, clicks: clk, ctr,
      page: page.replace('https://healthdesk.site', ''),
      matched_article: matched ? { lang: matched.lang, slug: matched.slug, title: matched.title } : null,
      suggestion, priority, status: 'new'
    });
  }

  // GA4 insights: high bounce rate pages, underperforming content
  try {
    const ga4 = await fetchGA4Data(30);
    // High bounce rate on blog pages
    for (const page of ga4.top_pages) {
      if (!page.path.includes('/blog/') || page.views < 3) continue;
      if (page.bounce_rate > 70) {
        opportunities.push({
          id: `opp-${Date.now()}-ga4-${opportunities.length}`,
          date: today, type: 'improve', priority: 'medium',
          query: `Wysoki bounce rate: ${page.bounce_rate}%`,
          position: 0, impressions: page.views, clicks: page.users, ctr: 0,
          page: page.path, matched_article: null,
          suggestion: `Strona ${page.path} ma ${page.bounce_rate}% bounce rate przy ${page.views} odsĹ‚onach. Popraw nagĹ‚Ăłwek, dodaj spis treĹ›ci, skrĂłÄ‡ wstÄ™p.`,
          status: 'new', action: 'improve'
        });
      }
    }
    // Pages with traffic but no blog coverage in that language
    for (const page of ga4.top_pages) {
      if (page.path.match(/^\/[a-z]{2}(-[A-Z]{2})?\/$/) && page.views >= 5) {
        const lang = page.path.replace(/\//g, '');
        const blogPages = ga4.top_pages.filter(p => p.path.startsWith(`/${lang}/blog/`));
        if (blogPages.length === 0) {
          opportunities.push({
            id: `opp-${Date.now()}-ga4lang-${opportunities.length}`,
            date: today, type: 'opportunity', priority: 'medium',
            query: `Ruch na /${lang}/ (${page.views} views) bez blogĂłw`,
            position: 0, impressions: page.views, clicks: page.users, ctr: 0,
            page: page.path, matched_article: null,
            suggestion: `Strona gĹ‚Ăłwna ${lang} ma ${page.views} odsĹ‚on ale ĹĽaden blog ${lang} nie generuje ruchu. Promuj istniejÄ…ce posty lub napisz dedykowane pod ten jÄ™zyk.`,
            status: 'new', action: 'promote'
          });
        }
      }
    }
  } catch (ga4Err) {
    console.error('[Insights] GA4 analysis failed:', ga4Err.message);
  }

  // Sort: high priority first, then by impressions
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  opportunities.sort((a, b) => (priorityOrder[a.priority] - priorityOrder[b.priority]) || (b.impressions - a.impressions));

  // Save to insights.json (append, keep max 500)
  const insights = loadInsights();
  // Remove old entries from today (re-run)
  insights.entries = insights.entries.filter(e => e.date !== today);
  insights.entries.push(...opportunities);
  // Cap at 500
  if (insights.entries.length > 500) insights.entries = insights.entries.slice(-500);
  insights.last_run = new Date().toISOString();
  saveInsights(insights);

  return opportunities;
}

app.post('/api/insights/opportunities', async (req, res) => {
  try {
    const opps = await runOpportunitiesAnalysis();
    res.json({ ok: true, count: opps.length, opportunities: opps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/insights', (req, res) => {
  const insights = loadInsights();
  const { type, status: filterStatus } = req.query;
  let entries = insights.entries || [];
  if (type) entries = entries.filter(e => e.type === type);
  if (filterStatus) entries = entries.filter(e => e.status === filterStatus);
  res.json({ last_run: insights.last_run, count: entries.length, entries });
});

app.post('/api/insights/:id/action', (req, res) => {
  const { status } = req.body;
  const insights = loadInsights();
  const entry = insights.entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  entry.status = status || 'actioned';
  saveInsights(insights);
  res.json({ ok: true, entry });
});

// Add insight keyword to content calendar
app.post('/api/insights/:id/add-to-calendar', (req, res) => {
  const { lang, cluster_id } = req.body;
  const insights = loadInsights();
  const entry = insights.entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Insight not found' });

  const cal = loadCalendar();
  // Find target cluster (first non-GSC cluster if not specified)
  let cluster = cluster_id
    ? cal.clusters.find(c => c.id === cluster_id)
    : cal.clusters.find(c => !c.name.includes('GSC'));
  if (!cluster) return res.status(400).json({ error: 'No cluster found' });

  const targetLang = lang || 'en';
  if (!cluster.keywords[targetLang]) cluster.keywords[targetLang] = [];

  // Check duplicate
  const exists = cluster.keywords[targetLang].some(k => k.keyword.toLowerCase() === entry.query.toLowerCase());
  if (exists) return res.json({ ok: false, message: 'Keyword already exists in calendar' });

  cluster.keywords[targetLang].push({
    keyword: entry.query,
    intent: 'informational', kd: 'low', serp_verified: true, serp_score: 3,
    status: 'pending', scheduled_date: null, slug: null, published_date: null,
    gsc_position: entry.position || null, gsc_clicks: entry.clicks || 0,
    gsc_impressions: entry.impressions || 0, gsc_last_check: null
  });
  saveCalendar(cal);

  entry.status = 'actioned';
  saveInsights(insights);

  res.json({ ok: true, cluster: cluster.name, lang: targetLang, keyword: entry.query });
});

// â”€â”€â”€ Autopilot: progress tracking â”€â”€â”€
let autopilotProgress = null;
// { status, currentStep, totalSteps, stepName, currentTopic, totalTopics, completedTopics, results[], error }

app.get('/api/ai/autopilot/status', (req, res) => {
  res.json(autopilotProgress || { status: 'idle' });
});

// â”€â”€â”€ Helper: slugify for autopilot â”€â”€â”€
function autoSlugify(text) {
  let slug = text.toLowerCase()
    .replace(/[Ä…Ă ]/g,'a').replace(/[Ä‡ÄŤ]/g,'c').replace(/[Ä™]/g,'e')
    .replace(/[Ĺ‚Äş]/g,'l').replace(/[Ĺ„Ă±]/g,'n').replace(/[ĂłĂ˛]/g,'o')
    .replace(/[Ĺ›Ĺˇ]/g,'s').replace(/[ĹşĹĽĹľ]/g,'z').replace(/[ĂĽĂş]/g,'u')
    .replace(/[Ă¶]/g,'o').replace(/[Ă¤]/g,'a').replace(/[Ăź]/g,'ss')
    .replace(/[Ă¨Ă©ĂŞĂ«]/g,'e').replace(/[Ă¬Ă­Ă®ĂŻ]/g,'i').replace(/[ĂąĂ»ĂĽ]/g,'u')
    // Cyrillic transliteration
    .replace(/[Đ°]/g,'a').replace(/[Đ±]/g,'b').replace(/[Đ˛]/g,'v').replace(/[Đł]/g,'g')
    .replace(/[Đ´]/g,'d').replace(/[Đµ]/g,'e').replace(/[Đ¶]/g,'zh').replace(/[Đ·]/g,'z')
    .replace(/[Đ¸]/g,'i').replace(/[Đą]/g,'y').replace(/[Đş]/g,'k').replace(/[Đ»]/g,'l')
    .replace(/[ĐĽ]/g,'m').replace(/[Đ˝]/g,'n').replace(/[Đľ]/g,'o').replace(/[Đż]/g,'p')
    .replace(/[Ń€]/g,'r').replace(/[Ń]/g,'s').replace(/[Ń‚]/g,'t').replace(/[Ń]/g,'u')
    .replace(/[Ń„]/g,'f').replace(/[Ń…]/g,'kh').replace(/[Ń†]/g,'ts').replace(/[Ń‡]/g,'ch')
    .replace(/[Ń]/g,'sh').replace(/[Ń‰]/g,'sch').replace(/[ŃŠŃŚ]/g,'').replace(/[Ń‹]/g,'y')
    .replace(/[ŃŤ]/g,'e').replace(/[ŃŽ]/g,'yu').replace(/[ŃŹ]/g,'ya').replace(/[Ń‘]/g,'yo')
    // Turkish special chars
    .replace(/[Äź]/g,'g').replace(/[Ä±]/g,'i').replace(/[Ĺź]/g,'s').replace(/[Ă§]/g,'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug;
}

// â”€â”€â”€ Helper: AI-based slug for CJK languages â”€â”€â”€
async function aiSlugify(keyword, lang) {
  const isCJK = ['ja', 'ko', 'zh-CN'].includes(lang);
  if (!isCJK) return autoSlugify(keyword);
  try {
    const result = await callClaude(
      'You generate URL slugs. Return ONLY the slug, nothing else.',
      `Generate a descriptive English URL slug (3-6 words, lowercase, hyphens) for this ${lang} blog topic:\n"${keyword}"\n\nReturn ONLY the slug like: desk-exercises-back-pain`,
      100, { model: 'haiku' }
    );
    const slug = result.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    return slug || autoSlugify(keyword);
  } catch (e) {
    console.error('[aiSlugify] Failed, using fallback:', e.message);
    return autoSlugify(keyword);
  }
}

function autoSlugify(text) {
  if (hasBrokenEncoding(text)) return '';
  return sanitizeSlug(text);
}

async function aiSlugify(keyword, lang) {
  const needsAiSlug = ['ja', 'ko', 'zh-CN', 'ru'].includes(lang);
  if (!needsAiSlug) return autoSlugify(keyword);
  try {
    const result = await callClaude(
      'You generate URL slugs. Return ONLY the slug, nothing else.',
      `Generate a descriptive English URL slug (3-6 words, lowercase, hyphens) for this ${lang} blog topic:\n"${keyword}"\n\nReturn ONLY the slug like: desk-exercises-back-pain`,
      100, { model: 'haiku' }
    );
    const slug = sanitizeSlug(result);
    return !isSuspiciousSlug(slug) ? slug : autoSlugify(keyword);
  } catch (e) {
    console.error('[aiSlugify] Failed, using fallback:', e.message);
    return autoSlugify(keyword);
  }
}

// â”€â”€â”€ Autopilot: single topic pipeline â”€â”€â”€
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
    const slugSource = !hasBrokenEncoding(title) ? title : topic;
    const slug = await aiSlugify(slugSource, lang);
    if (!slug || isSuspiciousSlug(slug)) {
      throw new Error(`Generated slug is invalid for ${lang}: ${slug || '<empty>'}`);
    }
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

    // Step 11: Save final article (with siblings auto-detection)
    updateStep(11, 'Save Article', 'running');
    // Calendar batches often publish different topics per language. Auto-linking by
    // cluster produced false cross-language siblings, so only explicit localized
    // versions should set this field.
    const siblingsMap = {};

    const siblingsYaml = Object.keys(siblingsMap).length > 0
      ? 'siblings:\n' + Object.entries(siblingsMap).map(([l, s]) => `  ${l}: "${s}"`).join('\n')
      : null;

    const finalFrontmatter = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `slug: "${slug}"`,
      `date: ${new Date().toISOString().split('T')[0]}`,
      `description: "${metaDescription.replace(/"/g, '\\"')}"`,
      `keyword: "${topic.replace(/"/g, '\\"')}"`,
      `tags: [${(outline.tags || []).map(t => `"${t}"`).join(', ')}]`,
      `lang: ${lang}`,
      heroResult?.filename ? `heroImage: "${heroResult.filename}"` : null,
      heroResult?.altText ? `image_alt: "${heroResult.altText}"` : null,
      siblingsYaml,
      draftResult.faqYaml || null,
      '---'
    ].filter(Boolean).join('\n');

    fs.writeFileSync(filePath, finalFrontmatter + '\n' + currentMarkdown, 'utf8');
    syncArticleKeyword(lang, slug, topic);

    // Update siblings in existing posts to include this new one
    for (const [sibLang, sibSlug] of Object.entries(siblingsMap)) {
      try {
        const sibFile = findArticleFile(sibLang, sibSlug);
        if (sibFile) {
          let sibContent = fs.readFileSync(sibFile, 'utf8');
          if (!sibContent.includes(`  ${lang}:`)) {
            if (sibContent.includes('siblings:')) {
              sibContent = sibContent.replace(/siblings:\n/, `siblings:\n  ${lang}: "${slug}"\n`);
            } else {
              const fmEnd = sibContent.indexOf('---', 4);
              if (fmEnd > 0) {
                sibContent = sibContent.slice(0, fmEnd) + `siblings:\n  ${lang}: "${slug}"\n` + sibContent.slice(fmEnd);
              }
            }
            fs.writeFileSync(sibFile, sibContent, 'utf8');
            console.log(`[Autopilot] Updated sibling ${sibLang}/${sibSlug} with ${lang}/${slug}`);
          }
        }
      } catch (sibErr) {
        console.error(`[Autopilot] Failed to update sibling ${sibLang}/${sibSlug}:`, sibErr.message);
      }
    }

    steps[10].status = 'done';
    if (Object.keys(siblingsMap).length > 0) {
      steps[10].detail = `${Object.keys(siblingsMap).length} siblings linked`;
    }

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

// â”€â”€â”€ API: Autopilot single â”€â”€â”€
app.post('/api/ai/autopilot', async (req, res) => {
  const { lang, topic, persona } = req.body;
  if (!lang || !topic) return res.status(400).json({ error: 'lang and topic required' });

  autopilotProgress = {
    status: 'running', currentStep: 0, totalSteps: 11, stepName: 'Starting...',
    currentTopic: topic, totalTopics: 1, completedTopics: 0, results: []
  };

  try {
    const result = await runAutopilot(lang, topic, persona);
    if (autopilotProgress) {
      autopilotProgress.status = 'done';
      autopilotProgress.completedTopics = 1;
      autopilotProgress.results = [result];
    }
    res.json(result);
    setTimeout(() => { if (autopilotProgress?.status === 'done') autopilotProgress = null; }, 60000);
  } catch (err) {
    console.error('[Autopilot] Error:', err.message);
    if (autopilotProgress) {
      autopilotProgress.status = 'error';
      autopilotProgress.error = err.message;
    }
    res.status(500).json({ error: err.message });
    setTimeout(() => { autopilotProgress = null; }, 60000);
  }
});

// â”€â”€â”€ API: Autopilot batch â”€â”€â”€
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€â”€ Content Calendar: Data helpers â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
  // Strategy: find the EARLIEST scheduled date across ALL clusters,
  // then pick 1 keyword per language from that date's cluster.
  // This ensures overdue/missed batches are processed first.
  const today = new Date().toISOString().split('T')[0];
  const skipLangs = new Set();

  if (!cal.clusters || cal.clusters.length === 0) return [];

  // Find languages already published/writing today
  for (const cluster of cal.clusters) {
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        if (kw.status === 'writing') skipLangs.add(lang);
        if (kw.status === 'published' && kw.published_date === today) skipLangs.add(lang);
      }
    }
  }

  // Find earliest scheduled date across all clusters
  let earliestDate = null;
  let earliestClusterIdx = -1;
  for (let ci = 0; ci < cal.clusters.length; ci++) {
    const cluster = cal.clusters[ci];
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        if (kw.status === 'scheduled' && kw.scheduled_date) {
          if (!earliestDate || kw.scheduled_date < earliestDate) {
            earliestDate = kw.scheduled_date;
            earliestClusterIdx = ci;
          }
        }
      }
    }
  }

  if (earliestClusterIdx === -1) {
    console.log('[Calendar] No scheduled keywords found in any cluster');
    return [];
  }

  const activeCluster = cal.clusters[earliestClusterIdx];
  console.log(`[Calendar] Earliest scheduled: ${earliestDate}, cluster ${earliestClusterIdx + 1}/${cal.clusters.length} â€” "${activeCluster.name}"`);

  const seenLangs = new Set(skipLangs);
  const batch = [];

  // Collect scheduled keywords from this cluster for the earliest date (1 per lang)
  for (const lang of Object.keys(activeCluster.keywords || {})) {
    if (seenLangs.has(lang)) continue;
    // Find keyword scheduled for earliestDate in this lang
    const kw = activeCluster.keywords[lang].find(k => k.status === 'scheduled' && k.scheduled_date === earliestDate);
    if (kw) {
      seenLangs.add(lang);
      batch.push({ ...kw, lang, cluster_id: activeCluster.id });
    }
  }

  // If some langs missing for this date, try same cluster's other scheduled keywords (earliest first)
  if (batch.length < 12) {
    for (const lang of Object.keys(activeCluster.keywords || {})) {
      if (seenLangs.has(lang)) continue;
      const kw = activeCluster.keywords[lang]
        .filter(k => k.status === 'scheduled')
        .sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''))[0];
      if (kw) {
        seenLangs.add(lang);
        batch.push({ ...kw, lang, cluster_id: activeCluster.id });
      }
    }
  }

  // Save cluster index for reference
  cal.last_cluster_index = earliestClusterIdx;

  if (skipLangs.size > 0) {
    console.log(`[Calendar] Skipping langs (already done today): ${[...skipLangs].join(', ')}`);
  }

  if (batch.length === 0) {
    console.log(`[Calendar] Cluster "${activeCluster.name}" has no schedulable keywords`);
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

async function finalizeSuccessfulPublication({ lang, keyword, slug, publishedDate = null }) {
  const finalDate = normalizeDateOnly(publishedDate) || new Date().toISOString().slice(0, 10);
  syncPublishedFrontmatterDate(lang, slug, finalDate);

  const cal = loadCalendar();
  updateKeywordStatus(cal, lang, keyword, {
    status: 'published',
    slug,
    published_date: finalDate
  });
  saveCalendar(cal);

  const studio = loadStudioData();
  const articleKey = `${lang}/${slug}`;
  studio.articles[articleKey] = {
    ...(studio.articles[articleKey] || {}),
    keyword,
    status: 'published'
  };
  saveStudioData(studio);

  const articleUrl = getPublishedArticleUrl(lang, slug);
  try {
    await submitUrlToGsc(articleUrl);
  } catch (gscErr) {
    console.error(`[Publish] GSC URL submit failed for ${articleUrl}: ${gscErr.message}`);
  }

  try {
    await resubmitSitemapToGsc(true);
  } catch (sitemapErr) {
    console.error(`[Publish] Sitemap resubmit failed: ${sitemapErr.message}`);
  }

  return { articleUrl, finalDate };
}

// â”€â”€â”€ Content Calendar: CRUD endpoints â”€â”€â”€

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

// â”€â”€â”€ Content Calendar: Generate keywords (Claude) â”€â”€â”€

app.post('/api/calendar/generate-keywords', async (req, res) => {
  const { cluster_id, cluster_name, langs, count } = req.body;
  const targetLangs = langs || ALL_CALENDAR_LANGS;
  const kwCount = count || 10;

  try {
    const prompt = `Generate ${kwCount} long-tail SEO keywords for EACH of the following languages: ${targetLangs.join(', ')}.

Topic cluster: "${cluster_name}"
Context: HealthDesk is a desktop wellness app for office workers â€” break reminders, eye exercises, stretch exercises, water intake tracking, posture tips, ergonomics.

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
      'You are an SEO keyword researcher specializing in health, wellness, and productivity content across multiple languages. Generate native, natural keywords â€” NOT translations.',
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

// â”€â”€â”€ Content Calendar: Verify keywords (Serper SERP analysis) â”€â”€â”€

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

// â”€â”€â”€ Content Calendar: Reset SERP verification â”€â”€â”€

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

// â”€â”€â”€ Content Calendar: Settings â”€â”€â”€

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

// â”€â”€â”€ Content Calendar: Run next keyword in queue â”€â”€â”€

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
  // autopilot â†’ build â†’ deploy â†’ GSC â†’ next keyword
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

      calendarProgress.step = `validate (${i + 1}/${batch.length})`;
      const validation = validatePost(slug, item.lang);
      if (!validation.valid) {
        const issueList = validation.issues.map(issue => `${issue.field}: ${issue.message}`).join('; ');
        throw new Error(`Validation failed: ${issueList}`);
      }

      // Step 2: Build
      calendarProgress.step = `build (${i + 1}/${batch.length})`;
      console.log(`${label} Building...`);
      await runBuild();

      // Step 3: Deploy to FTP
      calendarProgress.step = `deploy (${i + 1}/${batch.length})`;
      console.log(`${label} Deploying...`);
      await new Promise((resolve, reject) => {
        exec('node --use-system-ca deploy.js', { cwd: LANDING_ROOT, timeout: DEPLOY_TIMEOUT_MS }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
      });

      // Step 4: Finalize metadata + GSC
      calendarProgress.step = `gsc (${i + 1}/${batch.length})`;
      const { articleUrl } = await finalizeSuccessfulPublication({
        lang: item.lang,
        keyword: item.keyword,
        slug
      });
      console.log(`${label} Finalized: ${articleUrl}`);

      calendarProgress.results.push({ lang: item.lang, slug, status: 'ok' });
      completed++;
      console.log(`${label} DONE â€” ${slug} is LIVE (${completed}/${batch.length})`);

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

// â”€â”€â”€ Content Calendar: Stats â”€â”€â”€

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

// â”€â”€â”€ Content Calendar: Refresh GSC positions â”€â”€â”€

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

// â”€â”€â”€ Content Calendar: Auto-refresh underperforming articles â”€â”€â”€

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

    // Rebuild + redeploy
    await runBuild();
    await new Promise((resolve, reject) => {
      exec('node --use-system-ca deploy.js', { cwd: LANDING_ROOT, timeout: DEPLOY_TIMEOUT_MS }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message)); else resolve(stdout);
      });
    });

    await finalizeSuccessfulPublication({
      lang: target.lang,
      keyword: target.keyword,
      slug: target.slug,
      publishedDate: updatedDate
    });

    res.json({ refreshed: 1, keyword: target.keyword, lang: target.lang, slug: target.slug });

  } catch (err) {
    console.error('[Calendar Refresh] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Content Calendar: Schedule keywords â”€â”€â”€

app.post('/api/calendar/schedule', (req, res) => {
  const { cluster_id, lang, count } = req.body;
  const cal = loadCalendar();
  const intervalDays = cal.interval_days || 3;

  // Collect pending keywords PER CLUSTER, per language, sorted by KD (low first)
  // Deduplicate: track seen keywords globally to avoid scheduling the same keyword twice
  const seenKeywords = new Set();
  const pendingPerCluster = [];
  for (const cluster of cal.clusters) {
    if (cluster_id && cluster.id !== cluster_id) continue;
    const byLang = {};
    const langsToProcess = lang ? [lang] : Object.keys(cluster.keywords || {});
    for (const l of langsToProcess) {
      const kwList = cluster.keywords[l] || [];
      byLang[l] = kwList
        .filter(k => {
          if (k.status !== 'pending' || !k.serp_verified) return false;
          const key = `${l}|${k.keyword.toLowerCase()}`;
          if (seenKeywords.has(key)) return false;
          seenKeywords.add(key);
          return true;
        })
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
  // Round 0 â†’ cluster 0, Round 1 â†’ cluster 1, ... Round N â†’ cluster N%count, ...
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

// â”€â”€â”€ Content Calendar: Reschedule (reset scheduled â†’ pending, then re-schedule with new interval) â”€â”€â”€

app.post('/api/calendar/reschedule', (req, res) => {
  const { interval_days } = req.body;
  const cal = loadCalendar();

  // Update interval if provided
  if (interval_days !== undefined) {
    cal.interval_days = parseInt(interval_days) || 3;
  }
  const intervalDays = cal.interval_days || 3;

  // Reset all 'scheduled' keywords back to 'pending'
  let resetCount = 0;
  for (const cluster of cal.clusters) {
    for (const lang of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[lang]) {
        if (kw.status === 'scheduled') {
          kw.status = 'pending';
          kw.scheduled_date = null;
          resetCount++;
        }
      }
    }
  }

  // Now re-schedule using the same rotation logic
  // Deduplicate: track seen keywords globally to avoid scheduling the same keyword twice
  const seenKeywords = new Set();
  const pendingPerCluster = [];
  for (const cluster of cal.clusters) {
    const byLang = {};
    for (const l of Object.keys(cluster.keywords || {})) {
      byLang[l] = cluster.keywords[l]
        .filter(k => {
          if (k.status !== 'pending' || !k.serp_verified) return false;
          const key = `${l}|${k.keyword.toLowerCase()}`;
          if (seenKeywords.has(key)) return false;
          seenKeywords.add(key);
          return true;
        })
        .sort((a, b) => (a.serp_score || 5) - (b.serp_score || 5));
    }
    pendingPerCluster.push({ cluster, byLang });
  }

  const occupied = new Set();
  for (const cluster of cal.clusters) {
    for (const l of Object.keys(cluster.keywords || {})) {
      for (const kw of cluster.keywords[l]) {
        if (kw.status === 'published' && kw.published_date) occupied.add(`${kw.published_date}|${l}`);
      }
    }
  }

  let scheduled = 0, round = 0, emptyRoundsInRow = 0;
  const startDate = new Date();

  while (emptyRoundsInRow < pendingPerCluster.length) {
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
    if (anyScheduled) emptyRoundsInRow = 0;
    else emptyRoundsInRow++;
    round++;
  }

  saveCalendar(cal);
  res.json({ ok: true, reset: resetCount, scheduled, rounds: round, interval_days: intervalDays });
});

// â”€â”€â”€ Content Calendar: Import keywords â”€â”€â”€

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

// â”€â”€â”€ Content Calendar: Scheduler (auto-run) â”€â”€â”€

let calendarSchedulerInterval = null;

function startCalendarScheduler() {
  if (calendarSchedulerInterval) return;

  // Recovery: reset any "writing" keywords back to "scheduled" (stuck from crashed batch)
  try {
    const cal = loadCalendar();
    let recovered = 0;
    for (const cluster of cal.clusters) {
      for (const lang of Object.keys(cluster.keywords || {})) {
        for (const kw of cluster.keywords[lang]) {
          if (kw.status === 'writing') {
            kw.status = 'scheduled';
            recovered++;
          }
        }
      }
    }
    if (recovered > 0) {
      saveCalendar(cal);
      console.log(`[Calendar Scheduler] Recovered ${recovered} stuck "writing" keywords â†’ scheduled`);
    }
  } catch (e) {
    console.error('[Calendar Scheduler] Recovery failed:', e.message);
  }
  const schedulerCheck = async () => {
    try {
      const cal = loadCalendar();
      if (!cal.auto_enabled) return;
      if (!cal.next_run) return;
      if (calendarProgress && calendarProgress.status === 'running') return;

      // Compare dates only (ignore time), so scheduler triggers on the right DAY regardless of hour
      const today = new Date().toISOString().split('T')[0];
      const nextRunDate = new Date(cal.next_run).toISOString().split('T')[0];

      // Also check if there are overdue scheduled keywords (failed batch retry)
      let hasOverdueKeywords = false;
      for (const cluster of cal.clusters) {
        for (const lang of Object.keys(cluster.keywords || {})) {
          for (const kw of cluster.keywords[lang]) {
            if (kw.status === 'scheduled' && kw.scheduled_date && kw.scheduled_date <= today) {
              hasOverdueKeywords = true;
              break;
            }
          }
          if (hasOverdueKeywords) break;
        }
        if (hasOverdueKeywords) break;
      }

      if (today < nextRunDate && !hasOverdueKeywords) return;

      // If next_run date is in the past (missed days) or overdue keywords exist, catch up
      const isOverdue = today > nextRunDate || hasOverdueKeywords;
      console.log(`[Calendar Scheduler] Time to run! next_run was ${nextRunDate}, today is ${today}${isOverdue ? ' (catching up!)' : ''}`);

      // â”€â”€â”€ Repair pass: fix recently published posts with missing images â”€â”€â”€
      try {
        console.log('[Calendar Scheduler] Running repair pass...');
        const langs = fs.readdirSync(BLOG_DIR).filter(d => fs.statSync(path.join(BLOG_DIR, d)).isDirectory());
        let repaired = 0;
        for (const lang of langs) {
          const files = fs.readdirSync(path.join(BLOG_DIR, lang)).filter(f => f.endsWith('.md'));
          // Check only recent posts (last 30 files by mtime)
          const sorted = files
            .map(f => ({ name: f, mtime: fs.statSync(path.join(BLOG_DIR, lang, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 30);
          for (const { name } of sorted) {
            const slug = name.replace('.md', '');
            const imgPath = path.join(BLOG_IMAGES_DIR, `${slug}.webp`);
            if (!fs.existsSync(imgPath)) {
              console.log(`[Repair] Missing image for ${lang}/${slug}, generating...`);
              try {
                const content = fs.readFileSync(path.join(BLOG_DIR, lang, name), 'utf-8');
                const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
                const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
                const hero = await doHeroImage(slug, lang, titleMatch?.[1] || slug, descMatch?.[1] || '');
                upsertFrontmatterFields(path.join(BLOG_DIR, lang, name), {
                  heroImage: hero.filename,
                  image_alt: hero.altText
                });
                repaired++;
                console.log(`[Repair] Fixed image for ${lang}/${slug}`);
              } catch (repairErr) {
                console.error(`[Repair] Failed for ${lang}/${slug}: ${repairErr.message}`);
              }
            }
          }
        }
        // Process regeneration queue (images queued for re-generation due to quality issues)
        const regenQueue = loadRegenQueue();
        if (regenQueue.length > 0) {
          console.log(`[Repair] Processing ${regenQueue.length} queued image regenerations...`);
          const remaining = [];
          for (const item of regenQueue) {
            try {
              const mdFile = path.join(BLOG_DIR, item.lang, `${item.slug}.md`);
              if (!fs.existsSync(mdFile)) { continue; } // post deleted, skip
              const content = fs.readFileSync(mdFile, 'utf-8');
              const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
              const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
              const hero = await doHeroImage(item.slug, item.lang, titleMatch?.[1] || item.slug, descMatch?.[1] || '');
              upsertFrontmatterFields(mdFile, {
                heroImage: hero.filename,
                image_alt: hero.altText
              });
              repaired++;
              console.log(`[Repair] Regenerated image for ${item.lang}/${item.slug} (was: ${item.reason})`);
            } catch (regenErr) {
              console.error(`[Repair] Regen failed for ${item.lang}/${item.slug}: ${regenErr.message}`);
              remaining.push(item); // keep in queue for next run
            }
          }
          saveRegenQueue(remaining);
        }

        if (repaired > 0) {
          console.log(`[Repair] Repaired ${repaired} images, rebuilding...`);
          await runBuild();
          try {
            await new Promise((resolve, reject) => {
              exec('node --use-system-ca deploy.js', { cwd: LANDING_ROOT, timeout: DEPLOY_TIMEOUT_MS }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message)); else resolve(stdout);
              });
            });
            console.log(`[Repair] Deployed repaired site`);
          } catch (deployErr) {
            console.error(`[Repair] Deploy after repair failed: ${deployErr.message}`);
          }
        } else {
          console.log('[Repair] All recent posts have images â€” nothing to repair');
        }
      } catch (repairErr) {
        console.error('[Calendar Scheduler] Repair pass failed:', repairErr.message);
      }

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

      // Per-keyword full pipeline: write â†’ build â†’ deploy â†’ GSC â†’ next
      // Resilient: continues on error, skips existing files, logs everything
      const SCHEDULER_LOG = path.join(__dirname, 'scheduler_log.json');
      let schedulerLog;
      try { schedulerLog = JSON.parse(fs.readFileSync(SCHEDULER_LOG, 'utf-8')); }
      catch { schedulerLog = { runs: [] }; }
      const runLog = { date: new Date().toISOString(), batch_size: batch.length, results: [] };

      let completed = 0;
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const label = `[Scheduler] [${i + 1}/${batch.length}] [${item.lang}]`;
        calendarProgress.batch_done = i;
        calendarProgress.keyword = item.keyword;
        calendarProgress.lang = item.lang;

        try {
          // Check if article file already exists (skip duplicate writes)
          const existingFiles = fs.readdirSync(path.join(BLOG_DIR, item.lang)).filter(f => f.endsWith('.md'));
          const studio = loadStudioData();
          let existingSlug = null;
          for (const [key, art] of Object.entries(studio.articles || {})) {
            if (key.startsWith(item.lang + '/') && art.keyword === item.keyword) {
              existingSlug = key.split('/')[1];
              break;
            }
          }
          if (!existingSlug) {
            // Also check by matching keyword in frontmatter of existing files
            for (const f of existingFiles) {
              try {
                const content = fs.readFileSync(path.join(BLOG_DIR, item.lang, f), 'utf-8');
                const kwMatch = content.match(/^keyword:\s*["']?(.+?)["']?\s*$/m);
                if (kwMatch && kwMatch[1].toLowerCase() === item.keyword.toLowerCase()) {
                  existingSlug = f.replace('.md', '');
                  break;
                }
              } catch {}
            }
          }

          let slug;
          if (existingSlug) {
            // File already exists â€” skip writing, but still build + deploy + GSC
            console.log(`${label} EXISTS â€” skipping write, will build+deploy: ${existingSlug}`);
            slug = existingSlug;
          } else {
            // Step 1: Write article
            calendarProgress.step = `writing (${i + 1}/${batch.length})`;
            console.log(`${label} Autopilot: ${item.keyword}`);
            const result = await runAutopilot(item.lang, item.keyword);
            slug = result.slug;
          }

          // Step 1.5: Validate post completeness
          calendarProgress.step = `validate (${i + 1}/${batch.length})`;
          const validation = validatePost(slug, item.lang);
          if (!validation.valid) {
            const imgIssue = validation.issues.find(i => i.field === 'heroImage');
            if (imgIssue && validation.issues.length === 1) {
              // Only image missing â€” retry hero image generation
              console.log(`${label} Validation: hero image missing, retrying...`);
              try {
                const mdContent = fs.readFileSync(path.join(BLOG_DIR, item.lang, `${slug}.md`), 'utf-8');
                const titleMatch = mdContent.match(/^title:\s*["']?(.+?)["']?\s*$/m);
                const descMatch = mdContent.match(/^description:\s*["']?(.+?)["']?\s*$/m);
                const hero = await doHeroImage(slug, item.lang, titleMatch?.[1] || slug, descMatch?.[1] || '');
                upsertFrontmatterFields(path.join(BLOG_DIR, item.lang, `${slug}.md`), {
                  heroImage: hero.filename,
                  image_alt: hero.altText
                });
                console.log(`${label} Hero image recovered successfully`);
              } catch (imgRetryErr) {
                console.error(`${label} Hero image retry failed: ${imgRetryErr.message} â€” deploying without image`);
              }
            } else {
              const issueList = validation.issues.map(i => `${i.field}: ${i.message}`).join('; ');
              throw new Error(`Validation failed: ${issueList}`);
            }
          }

          // Step 2: Build
          calendarProgress.step = `build (${i + 1}/${batch.length})`;
          console.log(`${label} Building...`);
          await runBuild();

          // Step 3: Deploy to FTP (with retry)
          calendarProgress.step = `deploy (${i + 1}/${batch.length})`;
          console.log(`${label} Deploying...`);
          let deployAttempts = 3;
          let deployOk = false;
          for (let d = 1; d <= deployAttempts; d++) {
            try {
              await new Promise((resolve, reject) => {
                exec('node --use-system-ca deploy.js', { cwd: LANDING_ROOT, timeout: DEPLOY_TIMEOUT_MS }, (err, stdout, stderr) => {
                  if (err) reject(new Error(stderr || err.message)); else resolve(stdout);
                });
              });
              deployOk = true;
              break;
            } catch (deployErr) {
              console.error(`${label} Deploy attempt ${d}/${deployAttempts} failed: ${deployErr.message}`);
              if (d < deployAttempts) {
                const delay = d * 5000;
                console.log(`${label} Retrying deploy in ${delay / 1000}s...`);
                await new Promise(r => setTimeout(r, delay));
              } else {
                throw new Error(`Deploy failed after ${deployAttempts} attempts: ${deployErr.message}`);
              }
            }
          }

          // Step 4: Finalize metadata + GSC
          calendarProgress.step = `gsc (${i + 1}/${batch.length})`;
          const { articleUrl } = await finalizeSuccessfulPublication({
            lang: item.lang,
            keyword: item.keyword,
            slug
          });
          console.log(`${label} Finalized: ${articleUrl}`);

          calendarProgress.results.push({ lang: item.lang, slug, status: 'ok' });
          runLog.results.push({ lang: item.lang, keyword: item.keyword, status: 'ok', slug });
          completed++;
          console.log(`${label} DONE â€” ${slug} is LIVE (${completed}/${batch.length})`);

        } catch (err) {
          console.error(`${label} Error: ${err.message}`);
          calendarProgress.results.push({ lang: item.lang, keyword: item.keyword, status: 'error', error: err.message });
          runLog.results.push({ lang: item.lang, keyword: item.keyword, status: 'error', error: err.message });
          // Reset to scheduled so it retries next time (continue with rest of batch)
          const cal2 = loadCalendar();
          updateKeywordStatus(cal2, item.lang, item.keyword, { status: 'scheduled' });
          saveCalendar(cal2);
        }
      }

      // Save scheduler log
      runLog.completed = completed;
      runLog.errors = runLog.results.filter(r => r.status === 'error').length;
      schedulerLog.runs.push(runLog);
      if (schedulerLog.runs.length > 50) schedulerLog.runs = schedulerLog.runs.slice(-50);
      fs.writeFileSync(SCHEDULER_LOG, JSON.stringify(schedulerLog, null, 2), 'utf-8');
      console.log(`[Scheduler] Log saved: ${completed} ok, ${runLog.errors} errors`);

      // Set next_run to the next scheduled date (date-only, no time component)
      const cal3 = loadCalendar();
      const nextDate = new Date(today);
      nextDate.setDate(nextDate.getDate() + (cal3.interval_days || 3));
      cal3.next_run = nextDate.toISOString().split('T')[0];
      saveCalendar(cal3);

      calendarProgress.status = 'done';
      calendarProgress.batch_done = batch.length;
      console.log(`[Scheduler] Batch done: ${completed}/${batch.length}, next: ${cal3.next_run}`);

      // Windows notification with results
      const okResults = calendarProgress.results.filter(r => r.status === 'ok');
      const errResults = calendarProgress.results.filter(r => r.status === 'error');
      const langs = okResults.map(r => r.lang).join(', ');
      showNotification(
        `Blog Studio: ${completed}/${batch.length} opublikowanych`,
        errResults.length > 0
          ? `JÄ™zyki: ${langs}. BĹ‚Ä™dy: ${errResults.length}. NastÄ™pny: ${cal3.next_run}`
          : `JÄ™zyki: ${langs}. NastÄ™pny run: ${cal3.next_run}`
      );

      // Run GA4+GSC snapshot and opportunities analysis after batch
      setTimeout(async () => {
        try {
          console.log('[Calendar Scheduler] Snapshot GA4+GSC...');

          // GA4+GSC snapshot to history
          const historyPath = path.join(__dirname, 'gsc_history.json');
          let history;
          try { history = JSON.parse(fs.readFileSync(historyPath, 'utf-8')); }
          catch { history = { snapshots: [] }; }

          const snapshot = { date: new Date().toISOString().split('T')[0] };

          try {
            const ga4 = await fetchGA4Data(30);
            snapshot.ga4 = ga4.overview;
            snapshot.ga4_top_pages = ga4.top_pages.slice(0, 10);
            snapshot.ga4_sources = ga4.sources;
          } catch (e) { console.error('[Snapshot] GA4 failed:', e.message); }

          try {
            const { google } = require('googleapis');
            const auth = getGscAuth();
            const sc = google.searchconsole({ version: 'v1', auth });
            const end = new Date(), start = new Date();
            start.setDate(start.getDate() - 30);
            const gscResult = await sc.searchanalytics.query({
              siteUrl: SITE_URL_GSC,
              requestBody: {
                startDate: start.toISOString().slice(0, 10),
                endDate: end.toISOString().slice(0, 10),
                dimensions: ['query'], rowLimit: 20
              }
            });
            const rows = gscResult.data.rows || [];
            snapshot.gsc = {
              total_impressions: rows.reduce((s, r) => s + r.impressions, 0),
              total_clicks: rows.reduce((s, r) => s + r.clicks, 0),
              queries: rows.length,
              top_queries: rows.slice(0, 10).map(r => ({
                query: r.keys[0], impressions: r.impressions,
                clicks: r.clicks, position: Math.round(r.position * 10) / 10
              }))
            };
          } catch (e) { console.error('[Snapshot] GSC failed:', e.message); }

          // Compare with previous
          const prev = history.snapshots[history.snapshots.length - 1];
          const conclusions = [];
          if (prev?.ga4 && snapshot.ga4) {
            const sessDiff = snapshot.ga4.sessions - prev.ga4.sessions;
            const viewsDiff = snapshot.ga4.pageviews - prev.ga4.pageviews;
            conclusions.push(sessDiff >= 0 ? `Sesje: ${prev.ga4.sessions} â†’ ${snapshot.ga4.sessions} (+${sessDiff})` : `Sesje spadĹ‚y: ${prev.ga4.sessions} â†’ ${snapshot.ga4.sessions}`);
            conclusions.push(`OdsĹ‚ony: ${prev.ga4.pageviews} â†’ ${snapshot.ga4.pageviews} (${viewsDiff >= 0 ? '+' : ''}${viewsDiff})`);
          }
          if (prev?.gsc && snapshot.gsc) {
            const impDiff = snapshot.gsc.total_impressions - prev.gsc.total_impressions;
            conclusions.push(`GSC impresje: ${prev.gsc.total_impressions} â†’ ${snapshot.gsc.total_impressions} (${impDiff >= 0 ? '+' : ''}${impDiff})`);
          }
          snapshot.conclusions = conclusions;

          history.snapshots.push(snapshot);
          if (history.snapshots.length > 100) history.snapshots = history.snapshots.slice(-100);
          fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
          console.log('[Snapshot] GA4+GSC saved to history');

          // Opportunities analysis (GSC + GA4 combined)
          console.log('[Calendar Scheduler] Analiza opportunities...');
          const opps = await runOpportunitiesAnalysis();

          // Popup with combined results
          const ga4Line = snapshot.ga4 ? `GA4: ${snapshot.ga4.sessions} sesji, ${snapshot.ga4.pageviews} odsĹ‚on, bounce ${snapshot.ga4.bounce_rate}%` : '';
          const gscLine = snapshot.gsc ? `GSC: ${snapshot.gsc.total_impressions} impresji, ${snapshot.gsc.total_clicks} klikniÄ™Ä‡` : '';
          const oppsLine = opps.length > 0
            ? `\nInsights: ${opps.length} okazji\n` + opps.slice(0, 3).map(o => `â€˘ "${o.query}" (${o.type})`).join('\n')
            : '\nBrak nowych okazji';
          const concLine = conclusions.length > 0 ? '\n\nTrend:\n' + conclusions.join('\n') : '';

          showNotification(
            `Blog Studio: raport po batch`,
            `${ga4Line}\n${gscLine}${oppsLine}${concLine}\n\nSzczegĂłĹ‚y: localhost:4000 â†’ Insights`
          );
        } catch (e) {
          console.error('[Insights] BĹ‚Ä…d analizy:', e.message);
        }
      }, 30000);

      // If there are still overdue batches (missed multiple days), schedule another check soon
      if (isOverdue) {
        console.log('[Calendar Scheduler] Was overdue â€” will check again in 5 minutes for more missed batches');
        setTimeout(() => {
          if (!calendarProgress || calendarProgress.status !== 'running') {
            console.log('[Calendar Scheduler] Re-checking for overdue batches...');
            // Force re-check by clearing progress
            calendarProgress = null;
          }
        }, 300000); // 5 minutes
      }

    } catch (err) {
      console.error('[Calendar Scheduler] Error:', err.message);
      showNotification('Blog Studio: BĹÄ„D', err.message.substring(0, 150));
      if (calendarProgress) {
        calendarProgress.status = 'error';
        calendarProgress.error = err.message;
      }
    }

    setTimeout(() => {
      if (calendarProgress && calendarProgress.status !== 'running') calendarProgress = null;
    }, 120000);
  };
  calendarSchedulerInterval = setInterval(schedulerCheck, 3600000); // Check every hour

  // Run first check 30s after startup (don't wait a full hour)
  setTimeout(schedulerCheck, 30000);

  // â”€â”€â”€ Sitemap resubmit co 7 dni â”€â”€â”€
  const SITEMAP_RESUBMIT_STATE = path.join(__dirname, '.sitemap-resubmit.json');
  const sitemapResubmitCheck = async () => {
    try {
      if (!fs.existsSync(GSC_KEY_PATH)) return;
      let state = {};
      try { state = JSON.parse(fs.readFileSync(SITEMAP_RESUBMIT_STATE, 'utf-8')); } catch {}
      const lastResubmit = state.lastResubmit ? new Date(state.lastResubmit) : new Date(0);
      const daysSince = (Date.now() - lastResubmit.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) return;

      const auth = new google.auth.GoogleAuth({ keyFile: GSC_KEY_PATH, scopes: ['https://www.googleapis.com/auth/webmasters'] });
      const wm = google.webmasters({ version: 'v3', auth });
      await wm.sitemaps.submit({
        siteUrl: SITE_URL_GSC,
        feedpath: 'https://healthdesk.site/sitemap.xml',
      });
      state.lastResubmit = new Date().toISOString();
      fs.writeFileSync(SITEMAP_RESUBMIT_STATE, JSON.stringify(state, null, 2), 'utf-8');
      console.log(`[Sitemap Resubmit] Sitemap zgĹ‚oszona ponownie do GSC (co 7 dni)`);
    } catch (e) {
      console.error('[Sitemap Resubmit] Error:', e.message);
    }
  };
  // Check on startup (60s delay) and then every 24h
  setTimeout(sitemapResubmitCheck, 60000);
  setInterval(sitemapResubmitCheck, 86400000);

  console.log('[Calendar Scheduler] Started (checking every hour, first check in 30s)');
  console.log('[Sitemap Resubmit] Active (every 7 days, checked daily)');
}

// â”€â”€â”€ Start â”€â”€â”€
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

app.post('/api/calendar/recover-scheduled', async (req, res) => {
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
    step: 'recovery',
    results: [],
    started: new Date().toISOString()
  };

  for (const kw of batch) {
    updateKeywordStatus(cal, kw.lang, kw.keyword, { status: 'writing' });
  }
  saveCalendar(cal);

  res.json({ ok: true, batch_size: batch.length, keywords: batch.map(k => ({ lang: k.lang, keyword: k.keyword })) });

  let completed = 0;

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    const label = `[Recovery] [${i + 1}/${batch.length}] [${item.lang}]`;
    calendarProgress.batch_done = i;
    calendarProgress.keyword = item.keyword;
    calendarProgress.lang = item.lang;

    try {
      const langDir = path.join(BLOG_DIR, item.lang);
      const existingFiles = fs.existsSync(langDir)
        ? fs.readdirSync(langDir).filter(f => f.endsWith('.md'))
        : [];

      let existingSlug = null;
      const studio = loadStudioData();
      for (const [key, art] of Object.entries(studio.articles || {})) {
        if (key.startsWith(item.lang + '/') && art.keyword === item.keyword) {
          existingSlug = key.split('/')[1];
          break;
        }
      }

      if (!existingSlug) {
        for (const f of existingFiles) {
          try {
            const content = fs.readFileSync(path.join(langDir, f), 'utf-8');
            const kwMatch = content.match(/^keyword:\s*["']?(.+?)["']?\s*$/m);
            if (kwMatch && kwMatch[1].toLowerCase() === item.keyword.toLowerCase()) {
              existingSlug = f.replace('.md', '');
              break;
            }
          } catch {}
        }
      }

      let slug;
      if (existingSlug) {
        slug = existingSlug;
        console.log(`${label} EXISTS - skipping rewrite: ${slug}`);
      } else {
        calendarProgress.step = `writing (${i + 1}/${batch.length})`;
        console.log(`${label} Autopilot: ${item.keyword}`);
        const result = await runAutopilot(item.lang, item.keyword);
        slug = result.slug;
      }

      calendarProgress.step = `validate (${i + 1}/${batch.length})`;
      const validation = validatePost(slug, item.lang);
      if (!validation.valid) {
        const imgIssue = validation.issues.find(issue => issue.field === 'heroImage');
        if (imgIssue && validation.issues.length === 1) {
          console.log(`${label} Validation: hero image missing, retrying...`);
          const mdFile = path.join(BLOG_DIR, item.lang, `${slug}.md`);
          const mdContent = fs.readFileSync(mdFile, 'utf-8');
          const titleMatch = mdContent.match(/^title:\s*["']?(.+?)["']?\s*$/m);
          const descMatch = mdContent.match(/^description:\s*["']?(.+?)["']?\s*$/m);
          const hero = await doHeroImage(slug, item.lang, titleMatch?.[1] || slug, descMatch?.[1] || '');
          upsertFrontmatterFields(mdFile, {
            heroImage: hero.filename,
            image_alt: hero.altText
          });
        } else {
          const issueList = validation.issues.map(issue => `${issue.field}: ${issue.message}`).join('; ');
          throw new Error(`Validation failed: ${issueList}`);
        }
      }

      calendarProgress.step = `build (${i + 1}/${batch.length})`;
      console.log(`${label} Building...`);
      await runBuild();

      calendarProgress.step = `deploy (${i + 1}/${batch.length})`;
      console.log(`${label} Deploying...`);
      let deployError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await new Promise((resolve, reject) => {
            exec('node --use-system-ca deploy.js', { cwd: LANDING_ROOT, timeout: DEPLOY_TIMEOUT_MS }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message));
              else resolve(stdout);
            });
          });
          deployError = null;
          break;
        } catch (err) {
          deployError = err;
          console.error(`${label} Deploy attempt ${attempt}/3 failed: ${err.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 5000));
        }
      }
      if (deployError) throw new Error(`Deploy failed after 3 attempts: ${deployError.message}`);

      calendarProgress.step = `gsc (${i + 1}/${batch.length})`;
      const { articleUrl } = await finalizeSuccessfulPublication({
        lang: item.lang,
        keyword: item.keyword,
        slug
      });
      console.log(`${label} Finalized: ${articleUrl}`);

      calendarProgress.results.push({ lang: item.lang, slug, status: 'ok' });
      completed++;
      console.log(`${label} DONE - ${slug} is LIVE (${completed}/${batch.length})`);
    } catch (err) {
      console.error(`${label} Error: ${err.message}`);
      calendarProgress.results.push({ lang: item.lang, keyword: item.keyword, status: 'error', error: err.message });

      const cal2 = loadCalendar();
      updateKeywordStatus(cal2, item.lang, item.keyword, { status: 'scheduled' });
      saveCalendar(cal2);
    }
  }

  const cal3 = loadCalendar();
  if (cal3.auto_enabled) {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + (cal3.interval_days || 3));
    cal3.next_run = nextDate.toISOString().split('T')[0];
    saveCalendar(cal3);
  }

  calendarProgress.status = 'done';
  calendarProgress.batch_done = batch.length;
  console.log(`[Recovery] Batch complete: ${completed}/${batch.length} articles published`);

  setTimeout(() => {
    if (calendarProgress && calendarProgress.status !== 'running') calendarProgress = null;
  }, 120000);
});

