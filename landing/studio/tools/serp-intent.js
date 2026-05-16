'use strict';
/**
 * Warstwa G — SERP Intent Analyzer.
 * Z organic top10 (Serper) klasyfikuje dominujący typ SERP. Wynik wpinany
 * w Warstwę C jako sygnał content_intent: jeśli struktura draftu nie pasuje
 * do tego co Google realnie rankuje → kara/ostrzeżenie.
 *
 * Zero zależności. classifySerpIntent(organic, keyword) → {dominant, distribution, confidence}
 */

const TYPES = ['listicle', 'comparison', 'how_to', 'review', 'definition', 'category', 'video'];

function classifySerpIntent(organic, keyword) {
  const items = Array.isArray(organic) ? organic.filter(Boolean) : [];
  const dist = Object.fromEntries(TYPES.map(t => [t, 0]));
  if (!items.length) return { dominant: null, distribution: dist, confidence: 0, sample: 0 };

  const kw = (keyword || '').toLowerCase();

  for (const r of items) {
    const title = (r.title || '').toLowerCase();
    const link = (r.link || '').toLowerCase();
    const snip = (r.snippet || '').toLowerCase();
    const t = `${title} ${snip}`;

    if (/youtube\.com|vimeo\.com|\/watch\?|\/video\//.test(link)) dist.video++;
    if (/\bvs\.?\b|\bversus\b|\bcompared?\b| or |contre| oder | gegen /.test(t)) dist.comparison++;
    if (/^\s*\d+\b|\b(\d{1,3})\s+(best|top|great|essential|ways|tips|tools|apps|reasons)\b|\b(best|top)\b/.test(title)) dist.listicle++;
    if (/\bhow to\b|\bhow do\b|\bstep[- ]by[- ]step\b|\bguide\b|\btutorial\b|\bjak \b|\bcómo\b|\bcomment \b|\bwie man\b/.test(t)) dist.how_to++;
    if (/\breview(s|ed)?\b|\bhands[- ]on\b|\btested\b|\bwe tried\b|\brecenzja\b/.test(t)) dist.review++;
    if (/\bwhat (is|are)\b|\bdefinition\b|\bmeaning\b|\bco to (jest|są)\b|\bqué es\b|\bwas ist\b/.test(t)) dist.definition++;
    if (/amazon\.|\/shop\/|\/product|\/category|\/collections\/|play\.google\.com|apps\.apple\.com|\bbuy\b|\bprice\b/.test(`${link} ${t}`)) dist.category++;
  }

  let dominant = null, max = 0;
  for (const t of TYPES) { if (dist[t] > max) { max = dist[t]; dominant = t; } }
  // Wymagaj min. sygnału: ≥2 trafienia lub ≥40% próbki
  const confidence = max / items.length;
  if (max < 2 && confidence < 0.4) dominant = null;

  return { dominant, distribution: dist, confidence: +confidence.toFixed(2), sample: items.length };
}

/**
 * Sprawdza czy struktura artykułu (markdown) pasuje do dominującego intentu SERP.
 * Zwraca { ok, expected, penalty, message } — penalty 0..40 (do odjęcia od content_intent).
 */
function evaluateIntentMatch(serpIntent, body, headings) {
  if (!serpIntent || !serpIntent.dominant) return { ok: true, expected: null, penalty: 0, message: '' };
  const dom = serpIntent.dominant;
  const h2 = headings.filter(h => h.level === 2).length;
  const b = body.toLowerCase();
  const hasOrderedSteps = /(^|\n)\s*\d+\.\s+/.test(body) || /\bstep\s*\d|\bkrok\s*\d/i.test(body);
  const hasComparison = /\bvs\.?\b|\bversus\b/i.test(body) || /\|.*\|.*\|/.test(body) /* md table */;
  const headTxt = headings.map(h => h.text.toLowerCase()).join(' | ');

  let ok = true, message = '';
  switch (dom) {
    case 'listicle':
      ok = h2 >= 4; if (!ok) message = `SERP to listicle, a artykuł ma tylko ${h2} sekcji H2 (oczekiwane ≥4 pozycje)`;
      break;
    case 'comparison':
      ok = hasComparison || /\bvs\b|porówn|compar/i.test(headTxt);
      if (!ok) message = 'SERP to porównania, a artykuł nie ma struktury vs/tabeli porównawczej';
      break;
    case 'how_to':
      ok = hasOrderedSteps || /\bhow to\b|\bstep\b|\bkrok\b|\bjak \b/i.test(headTxt);
      if (!ok) message = 'SERP to poradniki how-to, a artykuł nie ma struktury kroków';
      break;
    case 'definition':
      ok = /\b(is|are|to jest|to są|oznacza|refers to)\b/.test(b.split(/\s+/).slice(0, 120).join(' '));
      if (!ok) message = 'SERP to definicje, a intro nie definiuje tematu na początku';
      break;
    case 'category':
      ok = true; message = 'SERP zdominowany przez strony kategorii/produktów (sklepy/store) — intent transakcyjny, artykuł informacyjny może nie rankować';
      break;
    case 'video':
      ok = true; message = 'SERP zdominowany przez wideo — rozważ embed/streszczenie wideo';
      break;
  }
  // category/video: nie blokujemy strukturalnie, tylko ostrzegamy (penalty miękki)
  const penalty = ok ? 0 : (dom === 'category' || dom === 'video' ? 10 : 30);
  return { ok, expected: dom, penalty, message };
}

module.exports = { classifySerpIntent, evaluateIntentMatch, TYPES };
