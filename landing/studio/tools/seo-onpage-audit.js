#!/usr/bin/env node
/**
 * SEO On-Page Audit — Warstwa C (pre-publish, markdown-level).
 *
 * Osobny concern od audytu AI-human (doAudit w server.js): tamten pyta
 * "czy brzmi ludzko?", ten pyta "czy Google scrawl/zrozumie/wyświetli/
 * zrankuje/skonwertuje ten URL?".
 *
 * MVP zakres: title / meta / H1-H3 / keyword&intent / internal links /
 * images / schema / E-E-A-T / cannibalization. Warstwa D (technical HTML
 * po buildzie) i E (link engine) — osobno, patrz TODO.md "SEO Engine".
 *
 * CLI:
 *   node tools/seo-onpage-audit.js --file ../src/content/blog/en/post.md [--keyword "kw"] [--report]
 * Programatycznie:
 *   const { auditOnPage } = require('./tools/seo-onpage-audit');
 *   const result = auditOnPage({ markdown, frontmatter, lang, keyword, sitemapUrls });
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ─── Wagi kategorii (suma = 100). Technical = 0 (Warstwa D liczy osobno). ───
const WEIGHTS = {
  title: 15, meta: 12, heading: 12, content_intent: 10,
  internal_link: 18, image: 10, schema: 8, eeat: 10, cannibalization: 5,
};
const THRESHOLD_PASS = 80;
const THRESHOLD_WARN = 65;

// ─── Parsowanie frontmatter (płaskie pola + wykrycie obecności kluczy) ───
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw, fmRaw: '' };
  const fmRaw = m[1];
  const body = m[2] || '';
  const fm = {};
  for (const line of fmRaw.split('\n')) {
    const fld = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!fld) continue;
    let [, key, val] = fld;
    val = val.trim().replace(/^["']|["']$/g, '');
    if (val === '' && !(key in fm)) fm[key] = '';
    else if (!(key in fm)) fm[key] = val;
  }
  fm.__hasFaq = /^faq:\s*$/m.test(fmRaw) || /^\s*-\s*q:/m.test(fmRaw);
  fm.__hasAuthor = /^author:/m.test(fmRaw);
  fm.__hasUpdated = /^(updated|modified|lastmod|updatedDate):/m.test(fmRaw);
  return { frontmatter: fm, body, fmRaw };
}

// ─── Pomocnicze ───
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(t => t.length > 2);
function wordCount(text) { return (text.replace(/[#*_>`\-]/g, ' ').match(/\b[\p{L}\p{N}]+\b/gu) || []).length; }

function extractHeadings(body) {
  const out = [];
  for (const line of body.split('\n')) {
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) out.push({ level: h[1].length, text: h[2].trim() });
  }
  return out;
}
function extractLinks(body) {
  const links = [];
  const re = /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
  let m;
  while ((m = re.exec(body))) links.push({ anchor: m[1].trim(), href: m[2].trim() });
  return links;
}
function extractImages(body) {
  const imgs = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
  let m;
  while ((m = re.exec(body))) imgs.push({ alt: m[1].trim(), src: m[2].trim() });
  return imgs;
}

// ─── Audyt ───
function auditOnPage({ markdown, frontmatter, lang, keyword, sitemapUrls = [] }) {
  const fm = frontmatter || {};
  lang = lang || fm.lang || 'en';
  const primaryKw = (keyword || fm.keyword || '').trim();
  const body = markdown;
  const bodyNorm = norm(body);
  const kwNorm = norm(primaryKw);

  const headings = extractHeadings(body);
  const links = extractLinks(body);
  const images = extractImages(body);
  const wc = wordCount(body);
  const first100 = norm(body.split(/\s+/).slice(0, 100).join(' '));

  const blocking = [], warnings = [], opportunities = [];
  const titleRecs = [], metaRecs = [], schemaRecs = [], cannRisks = [], linkSugg = [];
  const scores = {};

  // — TITLE —
  const title = fm.title || '';
  let s = 100;
  if (!title) { blocking.push('Brak title w frontmatter'); s = 0; }
  else {
    if (title.length < 30) { warnings.push(`Title za krótki (${title.length}<30 zn.)`); s -= 25; }
    if (title.length > 65) { warnings.push(`Title za długi (${title.length}>65 zn., ucięcie w SERP)`); s -= 20; }
    if (kwNorm && !norm(title).includes(kwNorm)) {
      const cov = tokens(primaryKw).filter(t => norm(title).includes(t)).length / Math.max(1, tokens(primaryKw).length);
      if (cov < 0.6) { warnings.push('Title nie zawiera primary keyword'); s -= 25; titleRecs.push(`Wpleć "${primaryKw}" naturalnie w title`); }
    }
    const h1 = headings.find(h => h.level === 1);
    if (h1 && norm(h1.text) === norm(title)) { warnings.push('Title = H1 (duplikat) — zróżnicuj'); s -= 10; }
  }
  scores.title = Math.max(0, s);

  // — META DESCRIPTION —
  const desc = fm.description || '';
  s = 100;
  if (!desc) { blocking.push('Brak meta description'); s = 0; }
  else {
    if (desc.length < 80) { warnings.push(`Meta za krótka (${desc.length}<80 zn.)`); s -= 25; }
    if (desc.length > 170) { warnings.push(`Meta za długa (${desc.length}>170 zn.)`); s -= 20; }
    if (kwNorm && !norm(desc).includes(kwNorm) && tokens(primaryKw).filter(t => norm(desc).includes(t)).length === 0) {
      warnings.push('Meta nie nawiązuje do keyword'); s -= 15; metaRecs.push(`Wpleć frazę/intencję "${primaryKw}" w meta`);
    }
    if (!/\b(discover|learn|find|compare|how|why|best|free|guide|sprawdź|poznaj|dowiedz|porównaj|darmow|najlepsz)\b/i.test(desc)) {
      opportunities.push('Meta bez wyraźnego hooka/CTA — rozważ wezwanie do działania'); s -= 8;
    }
  }
  scores.meta = Math.max(0, s);

  // — HEADINGS —
  s = 100;
  const h1count = headings.filter(h => h.level === 1).length;
  if (h1count > 1) { blocking.push(`Wiele H1 (${h1count}) w treści`); s -= 50; }
  // Posty HealthDesk: H1 = title z templatki, body zaczyna od H2 → 0× "# " jest OK.
  const h2 = headings.filter(h => h.level === 2).length;
  if (h2 === 0) { warnings.push('Brak nagłówków H2 — płaska struktura'); s -= 30; }
  // przeskoki poziomów (np. H2 → H4)
  let prev = headings.length ? headings[0].level : 0;
  for (const h of headings) { if (h.level - prev > 1) { warnings.push(`Przeskok nagłówków H${prev}→H${h.level} ("${h.text.slice(0, 40)}")`); s -= 10; break; } prev = h.level; }
  if (kwNorm) {
    const hWithKw = headings.filter(h => norm(h.text).includes(kwNorm)).length;
    if (headings.length >= 4 && hWithKw / headings.length > 0.6) { warnings.push('Keyword w >60% nagłówków — ryzyko stuffingu'); s -= 15; }
  }
  scores.heading = Math.max(0, s);

  // — CONTENT / INTENT —
  s = 100;
  if (wc < 600) { warnings.push(`Treść krótka (${wc} słów) — ryzyko thin content`); s -= 30; }
  if (kwNorm) {
    const occ = (bodyNorm.match(new RegExp(escapeRe(kwNorm), 'g')) || []).length;
    if (occ === 0 && tokens(primaryKw).every(t => !bodyNorm.includes(t))) { blocking.push('Primary keyword nieobecny w treści'); s -= 40; }
    const density = wc ? (occ * tokens(primaryKw).length) / wc : 0;
    if (density > 0.035) { warnings.push(`Gęstość keyword ~${(density * 100).toFixed(1)}% — możliwy stuffing`); s -= 20; }
    if (occ > 0 && !first100.includes(kwNorm) && tokens(primaryKw).filter(t => first100.includes(t)).length === 0) {
      opportunities.push('Primary keyword nie pada w pierwszych ~100 słowach (intro)'); s -= 10;
    }
  }
  // konkluzja
  const lastH = headings[headings.length - 1];
  if (!lastH || !/(conclusion|verdict|which|should you|final|takeaway|summary|wniosk|podsumowanie|który wybrać|werdykt)/i.test(lastH.text)) {
    opportunities.push('Brak wyraźnej sekcji konkluzji/werdyktu'); s -= 8;
  }
  scores.content_intent = Math.max(0, s);

  // — INTERNAL LINKS —
  s = 100;
  const internal = links.filter(l => /healthdesk\.site/i.test(l.href) || l.href.startsWith('/'));
  const langRe = escapeRe(lang);
  const moneyRe = new RegExp(`healthdesk\\.site/${langRe}/?($|["')\\s])|^/${langRe}/?$`, 'i');
  const moneyLinks = internal.filter(l => moneyRe.test(l.href) || /\/(download|pricing|app)\b/i.test(l.href));
  if (internal.length === 0) { blocking.push('Zero linków wewnętrznych'); s = 10; }
  else if (internal.length < 3) { warnings.push(`Tylko ${internal.length} link(i) wewn. (<3)`); s -= 25; }
  if (moneyLinks.length === 0) { warnings.push('Brak linku do money page (landing/oferta)'); s -= 25; linkSugg.push(`Dodaj link do https://healthdesk.site/${lang}/ (money page)`); }
  const exactMatch = internal.filter(l => kwNorm && norm(l.anchor) === kwNorm).length;
  if (exactMatch > 1) { opportunities.push(`${exactMatch}× exact-match anchor — zróżnicuj anchory`); s -= 8; }
  if (internal.length < 5) opportunities.push('Rozważ więcej linków do powiązanych postów (topical cluster)');
  scores.internal_link = Math.max(0, s);

  // — IMAGES —
  s = 100;
  if (!fm.heroImage) { warnings.push('Brak heroImage w frontmatter'); s -= 30; }
  if (!fm.image_alt || fm.image_alt.length < 10) { warnings.push('Brak/za krótki image_alt hero'); s -= 20; }
  else if (kwNorm && tokens(primaryKw).filter(t => norm(fm.image_alt).includes(t)).length === 0) {
    opportunities.push('image_alt nie nawiązuje do keyword'); s -= 8;
  }
  const noAlt = images.filter(i => !i.alt).length;
  if (noAlt > 0) { warnings.push(`${noAlt} obraz(y) inline bez alt`); s -= 10 * Math.min(3, noAlt); }
  scores.image = Math.max(0, s);

  // — SCHEMA (rekomendacje; egzekucja w Warstwie D na HTML) —
  s = 100;
  schemaRecs.push('Article/BlogPosting (template-level) — zweryfikować w Warstwie D');
  schemaRecs.push('BreadcrumbList — zweryfikować w Warstwie D');
  if (fm.__hasFaq) schemaRecs.push('FAQPage — frontmatter ma faq[], upewnij się że renderuje JSON-LD');
  else { opportunities.push('Brak faq[] — rozważ FAQ + FAQPage schema (PAA/snippet)'); s -= 20; }
  scores.schema = Math.max(0, s);

  // — E-E-A-T —
  // UWAGA warstwowość: author + datePublished/dateModified są wstrzykiwane
  // przez build.js (AUTHOR_SCHEMA Person + dateModified=meta.updated||date)
  // do JSON-LD KAŻDego posta — NIE sprawdzamy tu frontmatter.author/updated
  // (false positive). Walidacja realnego renderu (schema + widoczny byline)
  // należy do Warstwy D (audyt HTML po buildzie).
  s = 100;
  const expSignals = /(\bI tried\b|\bI tested\b|in my experience|I remember|I found|when I|hands-on|after using|przetestowa|z mojego doświadczenia|sprawdziłem|używałem)/i;
  if (!expSignals.test(body)) { warnings.push('Brak sygnałów first-hand experience (Experience w E-E-A-T)'); s -= 35; }
  const srcLinks = links.filter(l => /^https?:\/\//i.test(l.href) && !/healthdesk\.site/i.test(l.href)).length;
  if (srcLinks === 0) { opportunities.push('Brak linków do źródeł zewnętrznych (autorytet/trust)'); s -= 15; }
  if (fm.__hasUpdated) opportunities.push('frontmatter ma updated — dobrze (Warstwa D zweryfikuje dateModified w schema)');
  scores.eeat = Math.max(0, s);

  // — CANNIBALIZATION (vs sitemap, ten sam lang, nakładka tokenów keyword) —
  s = 100;
  const kwTok = new Set(tokens(primaryKw));
  if (kwTok.size && sitemapUrls.length) {
    for (const u of sitemapUrls) {
      if (!new RegExp(`/${escapeRe(lang)}/blog/`, 'i').test(u)) continue;
      if (fm.slug && u.includes(fm.slug)) continue; // to ten sam wpis
      const slugTok = new Set(tokens(u.split('/').filter(Boolean).pop().replace(/-/g, ' ')));
      const inter = [...kwTok].filter(t => slugTok.has(t)).length;
      const jacc = inter / new Set([...kwTok, ...slugTok]).size;
      if (jacc >= 0.5) { cannRisks.push({ url: u, overlap: +jacc.toFixed(2) }); }
    }
    if (cannRisks.length) { warnings.push(`Ryzyko kanibalizacji z ${cannRisks.length} URL (ten sam intent/fraza)`); s -= 20 * Math.min(3, cannRisks.length); }
  }
  scores.cannibalization = Math.max(0, s);

  // — FINAL —
  let final = 0;
  for (const k of Object.keys(WEIGHTS)) final += (scores[k] ?? 100) * WEIGHTS[k] / 100;
  final = Math.round(final);
  let status = final >= THRESHOLD_PASS ? 'PASS' : final >= THRESHOLD_WARN ? 'WARN' : 'FAIL';
  if (blocking.length) status = 'FAIL';

  return {
    score: final, status,
    category_scores: scores,
    blocking_issues: blocking,
    warnings,
    opportunities,
    auto_fixes: [], // MVP: same rekomendacje; auto-fix w kolejnym etapie
    internal_link_suggestions: linkSugg,
    schema_recommendations: schemaRecs,
    title_recommendations: titleRecs,
    meta_recommendations: metaRecs,
    cannibalization_risks: cannRisks,
    meta: { lang, keyword: primaryKw, word_count: wc, headings: headings.length, internal_links: internal.length },
  };
}

// ─── Sitemap loader (best-effort) ───
function loadSitemapUrls(sitemapPath) {
  try {
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1].trim());
  } catch { return []; }
}

// ─── CLI ───
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; a[k] = v; }
  }
  return a;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) { console.error('Użycie: node tools/seo-onpage-audit.js --file <post.md> [--keyword "kw"] [--sitemap <path>] [--report]'); process.exit(2); }
  const filePath = path.resolve(args.file);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const sitemapPath = args.sitemap ? path.resolve(args.sitemap) : path.join(__dirname, '..', '..', 'dist', 'sitemap.xml');
  const sitemapUrls = loadSitemapUrls(sitemapPath);
  const result = auditOnPage({ markdown: body, frontmatter, lang: frontmatter.lang, keyword: args.keyword, sitemapUrls });

  console.log(JSON.stringify(result, null, 2));
  const icon = result.status === 'PASS' ? '✅' : result.status === 'WARN' ? '🟡' : '🔴';
  console.error(`\n${icon} SEO On-Page: ${result.score}/100 (${result.status}) — ${path.basename(filePath)}`);
  console.error(`   blocking: ${result.blocking_issues.length} | warnings: ${result.warnings.length} | opportunities: ${result.opportunities.length}`);

  if (args.report) {
    const dir = path.join(__dirname, '..', 'reports', 'seo-audits');
    fs.mkdirSync(dir, { recursive: true });
    const slug = frontmatter.slug || path.basename(filePath, '.md');
    const date = new Date().toISOString().slice(0, 10);
    const base = path.join(dir, `${date}-${slug}`);
    fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2), 'utf8');
    const md = [
      `# SEO On-Page Audit — ${slug}`, '',
      `**Score:** ${result.score}/100 — **${result.status}**`, `**Keyword:** ${result.meta.keyword} | **Lang:** ${result.meta.lang} | **Słów:** ${result.meta.word_count}`, '',
      '## Category scores', ...Object.entries(result.category_scores).map(([k, v]) => `- ${k}: ${v}`), '',
      result.blocking_issues.length ? '## 🔴 Blocking\n' + result.blocking_issues.map(x => `- ${x}`).join('\n') : '',
      result.warnings.length ? '## 🟡 Warnings\n' + result.warnings.map(x => `- ${x}`).join('\n') : '',
      result.opportunities.length ? '## 💡 Opportunities\n' + result.opportunities.map(x => `- ${x}`).join('\n') : '',
      result.cannibalization_risks.length ? '## ⚠️ Cannibalization\n' + result.cannibalization_risks.map(x => `- ${x.url} (overlap ${x.overlap})`).join('\n') : '',
    ].filter(Boolean).join('\n');
    fs.writeFileSync(`${base}.md`, md, 'utf8');
    console.error(`   raport: reports/seo-audits/${date}-${slug}.{json,md}`);
  }
  process.exit(result.status === 'FAIL' ? 1 : 0);
}

module.exports = { auditOnPage, parseFrontmatter, loadSitemapUrls, WEIGHTS, THRESHOLD_PASS, THRESHOLD_WARN };
