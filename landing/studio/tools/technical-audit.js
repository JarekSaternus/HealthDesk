'use strict';
/**
 * Warstwa D — Technical HTML audit (po buildzie, przed deployem).
 * Audytuje WYRENDEROWANY HTML, nie markdown. Łapie regresje które
 * przechodzą Warstwę C (markdown ok), a psują się w finalnym HTML:
 * brak canonicala, noindex przez pomyłkę, zepsuty JSON-LD, kilka H1,
 * obrazy bez wymiarów, martwe linki wewnętrzne.
 *
 * Bez zależności (regex/string — wystarcza dla tych konkretnych checków).
 * auditHtml(html, opts) → { score, status, blocking_issues[], warnings[],
 *   opportunities[], checks{} }   opts: { expectedCanonical, internalExists(fn) }
 */

function tag(html, re) { const m = html.match(re); return m ? m[1].trim() : null; }

function auditHtml(html, opts = {}) {
  const blocking = [], warnings = [], opportunities = [];
  const checks = {};
  html = html || '';

  // — TITLE —
  const title = tag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!title) blocking.push('Brak <title>');
  else if (title.length < 15 || title.length > 70) warnings.push(`<title> długość ${title.length} poza 15-70`);
  checks.title = title;

  // — META DESCRIPTION —
  const desc = tag(html, /<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i);
  if (!desc) blocking.push('Brak meta description');
  else if (desc.length < 50) warnings.push(`meta description krótka (${desc.length})`);
  checks.description_len = desc ? desc.length : 0;

  // — CANONICAL —
  const canonical = tag(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (!canonical) blocking.push('Brak <link rel=canonical>');
  else if (opts.expectedCanonical && canonical.replace(/\/$/, '') !== opts.expectedCanonical.replace(/\/$/, '')) {
    blocking.push(`canonical ≠ oczekiwany URL (${canonical} vs ${opts.expectedCanonical})`);
  }
  checks.canonical = canonical;

  // — ROBOTS (noindex = krytyczny dla posta który ma być w indeksie) —
  const robots = tag(html, /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["']/i);
  if (robots && /noindex/i.test(robots)) blocking.push(`robots zawiera noindex: "${robots}"`);
  checks.robots = robots || '(brak — ok, domyślnie index)';

  // — OPEN GRAPH / TWITTER —
  for (const og of ['og:title', 'og:image', 'og:type']) {
    if (!new RegExp(`property=["']${og}["']`, 'i').test(html)) warnings.push(`Brak ${og}`);
  }
  if (!/name=["']twitter:card["']/i.test(html)) opportunities.push('Brak twitter:card');

  // — JSON-LD —
  const ldBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  let types = [];
  if (!ldBlocks.length) blocking.push('Brak JSON-LD');
  for (const b of ldBlocks) {
    try {
      const parsed = JSON.parse(b);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const o of arr) if (o && o['@type']) types.push(o['@type']);
    } catch (e) { blocking.push(`JSON-LD nie parsuje się (${e.message.slice(0, 40)})`); }
  }
  if (ldBlocks.length && !types.some(t => /BlogPosting|Article/.test(t))) warnings.push('Brak schematu BlogPosting/Article');
  if (ldBlocks.length && !types.includes('BreadcrumbList')) warnings.push('Brak BreadcrumbList schema');
  checks.jsonld_types = types;

  // — H1 (dokładnie 1) —
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1 === 0) blocking.push('Brak <h1> w DOM');
  else if (h1 > 1) blocking.push(`Wiele <h1> w DOM (${h1})`);
  checks.h1_count = h1;

  // — OBRAZY: width/height + lazy (poza pierwszym = hero/LCP) —
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  let noDim = 0, missingLazy = 0;
  imgs.forEach((img, i) => {
    if (!/\bwidth=/.test(img) || !/\bheight=/.test(img)) noDim++;
    if (i > 0 && !/loading=["']lazy["']/.test(img)) missingLazy++;
  });
  if (noDim > 0) warnings.push(`${noDim}/${imgs.length} <img> bez width/height (ryzyko CLS)`);
  if (missingLazy > 0) opportunities.push(`${missingLazy} <img> poza hero bez loading="lazy"`);
  checks.images = { total: imgs.length, no_dim: noDim, missing_lazy: missingLazy };

  // — LINKI WEWNĘTRZNE: martwe (jeśli podano internalExists) —
  if (typeof opts.internalExists === 'function') {
    const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"'#?]+)[^"']*["']/gi)].map(m => m[1]);
    const internal = hrefs.filter(h => h.startsWith('/') || /healthdesk\.site/i.test(h));
    const broken = [];
    for (const h of [...new Set(internal)]) {
      const pathPart = h.replace(/^https?:\/\/[^/]+/, '');
      if (/\.(png|jpg|webp|svg|css|js|xml|ico|txt)$/i.test(pathPart)) continue;
      if (opts.internalExists(pathPart) === false) broken.push(pathPart);
    }
    if (broken.length) blocking.push(`Martwe linki wewnętrzne (${broken.length}): ${broken.slice(0, 5).join(', ')}`);
    checks.internal_links = { checked: internal.length, broken: broken.length };
  }

  // — WYNIK —
  let score = 100 - blocking.length * 25 - warnings.length * 6 - opportunities.length * 2;
  score = Math.max(0, Math.min(100, score));
  const status = blocking.length ? 'FAIL' : (warnings.length > 2 ? 'WARN' : 'PASS');
  return { score, status, blocking_issues: blocking, warnings, opportunities, checks };
}

module.exports = { auditHtml };

if (require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  if (fi === -1) { console.error('Użycie: node tools/technical-audit.js --file dist/<lang>/blog/<slug>/index.html [--canonical URL]'); process.exit(2); }
  const html = fs.readFileSync(args[fi + 1], 'utf8');
  const ci = args.indexOf('--canonical');
  const r = auditHtml(html, { expectedCanonical: ci > -1 ? args[ci + 1] : undefined });
  console.log(JSON.stringify(r, null, 2));
  const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '🟡' : '🔴';
  console.error(`\n${icon} Technical: ${r.score}/100 (${r.status}) — blocking ${r.blocking_issues.length}, warnings ${r.warnings.length}`);
  process.exit(r.status === 'FAIL' ? 1 : 0);
}
