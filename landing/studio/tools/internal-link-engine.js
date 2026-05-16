'use strict';
/**
 * Warstwa E — Internal Linking Engine (sugestie, nie auto-injection).
 * Czysta logika. Z indeksu URL (budowanego w server.js z frontmatterów)
 * dla danego posta proponuje:
 *  - linki WYCHODZĄCE do semantycznie powiązanych istniejących postów,
 *  - stare posty które powinny linkować DO tego (inbound),
 *  - gwarancję ścieżki do money page (landing /{lang}/),
 *  - kontrolę różnorodności anchorów (bez over-optimized exact-match).
 *
 * Relacja = Jaccard na tokenach (title + keyword + tags), ten sam język.
 */

const STOP = new Set(['the','and','for','with','your','you','how','what','why','from','that','this','are','was','des','der','und','les','des','dla','jak','czy','przy','les','pour','para','com','und','los','las','del','que','una','con']);
function tok(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}
function profile(entry) {
  return new Set(tok(`${entry.title || ''} ${entry.keyword || ''} ${(entry.tags || []).join(' ')}`));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// index: [{url,lang,slug,title,keyword,tags,money_page}], target: ten sam kształt + body (markdown)
function suggestLinks(target, index, opts = {}) {
  const maxOut = opts.maxOutbound || 6;
  const maxIn = opts.maxInbound || 5;
  const lang = target.lang;
  const body = (target.body || '').toLowerCase();
  const tProf = profile(target);

  const sameLang = index.filter(e => e.lang === lang && e.slug !== target.slug);
  const scored = sameLang.map(e => ({ e, score: jaccard(tProf, profile(e)) }))
    .filter(x => x.score >= (opts.minScore || 0.08))
    .sort((a, b) => b.score - a.score);

  // już zalinkowane w treści (po slug/url) — nie proponuj ponownie
  const alreadyLinked = (slug, url) => body.includes(slug) || (url && body.includes(url.replace(/^https?:\/\/[^/]+/, '')));

  const outbound = [];
  const usedAnchors = new Set();
  for (const { e, score } of scored) {
    if (outbound.length >= maxOut) break;
    if (alreadyLinked(e.slug, e.url)) continue;
    // anchor: tytuł lub fraza — różnicuj, unikaj 2× tego samego exact keyword
    let anchor = e.title || e.keyword || e.slug.replace(/-/g, ' ');
    const akey = anchor.toLowerCase();
    if (usedAnchors.has(akey)) anchor = e.keyword || anchor;
    usedAnchors.add(anchor.toLowerCase());
    outbound.push({ url: e.url, slug: e.slug, anchor, relevance: +score.toFixed(2) });
  }

  // inbound: istniejące posty powiązane, które NIE linkują jeszcze do targetu
  const inbound = [];
  for (const { e, score } of scored) {
    if (inbound.length >= maxIn) break;
    if (e.body && (e.body.toLowerCase().includes(target.slug))) continue; // już linkuje
    inbound.push({ url: e.url, slug: e.slug, suggested_anchor: target.title || target.keyword, relevance: +score.toFixed(2) });
  }

  // money page: czy treść linkuje do landinga /{lang}/ lub download/pricing?
  const moneyRe = new RegExp(`/${lang}/?(["')\\s]|$)|/(download|pricing|app)\\b|healthdesk\\.site/?(["')\\s]|$)`, 'i');
  const hasMoneyLink = moneyRe.test(target.body || '');
  const moneyPages = index.filter(e => e.lang === lang && e.money_page);
  const moneyTarget = moneyPages[0] ? moneyPages[0].url : `https://healthdesk.site/${lang}/`;

  return {
    outbound,
    inbound,
    money_page_ok: hasMoneyLink,
    money_page_suggestion: hasMoneyLink ? null : { url: moneyTarget, anchor: 'HealthDesk', note: 'Brak linku do money page — dodaj kontekstowy CTA' },
    anchor_diversity_ok: usedAnchors.size === outbound.length,
    stats: { candidates: scored.length, outbound: outbound.length, inbound: inbound.length },
  };
}

module.exports = { suggestLinks, jaccard, tok };
