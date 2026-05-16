'use strict';
/**
 * Backlink tracker (pragmatyczny — bez płatnego API typu Ahrefs/Majestic).
 *
 * OGRANICZENIE: GSC API nie eksponuje raportu linków zewn., nie mamy
 * indeksu backlinków. Dlatego tracker łączy 2 realne, dostępne sygnały:
 *  1) rejestr manualny + liveness check (czy link nadal istnieje na stronie),
 *  2) auto-discovery z GA4 — domeny referralowe realnie przysyłające ruch
 *     (proxy: tylko backlinki które dają sesje, ale to te które się liczą).
 *
 * Czysta logika (bez I/O). I/O + GA4 + fetch w server.js.
 */

function normDomain(s) {
  return String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].trim();
}

const SELF = 'healthdesk.site';
const IGNORED_SOURCES = new Set([
  '(direct)', 'google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'yandex',
  SELF, 'healthdesk', '(not set)',
]);

// True dla search engines / self / placeholderów — działa zarówno dla
// nazw źródeł GA4 ("google") jak i domen ("google.com", "www.bing.de").
function isIgnoredSource(s) {
  const d = normDomain(s);
  if (!d) return true;
  if (IGNORED_SOURCES.has(d) || IGNORED_SOURCES.has(d.split('.')[0])) return true;
  if (d.endsWith(SELF)) return true;
  return /(^|\.)(google|bing|duckduckgo|yahoo|yandex|ecosia|baidu)\.[a-z.]+$/.test(d);
}

// Czy w HTML jest link do naszej domeny (backlink żywy).
function linkPresent(html, selfDomain = SELF) {
  if (!html) return false;
  const re = new RegExp(`<a\\b[^>]*href\\s*=\\s*["']https?://(?:www\\.)?${selfDomain.replace(/\./g, '\\.')}[/"']`, 'i');
  return re.test(html);
}

// Diff referrerów (z GA4) względem rejestru → nowe / znane / utracone.
function diffReferrers(ga4Rows, registry) {
  const known = new Set((registry || []).map(b => normDomain(b.source_domain)));
  const seen = new Set();
  const fresh = [];
  for (const r of ga4Rows || []) {
    const src = normDomain(r.source);
    if (!src || isIgnoredSource(r.source)) continue;
    if ((r.sessions || 0) < 1) continue;
    seen.add(src);
    if (!known.has(src)) fresh.push({ source_domain: src, sessions: r.sessions });
  }
  // utracone: w rejestrze, status live, ale nie pojawiły się w referralach
  // (sygnał słaby — backlink może żyć bez ruchu; tylko informacyjnie)
  const noTraffic = (registry || [])
    .filter(b => b.status === 'live' && !seen.has(normDomain(b.source_domain)))
    .map(b => b.source_domain);
  return { new: fresh, active: [...seen], no_traffic: noTraffic };
}

// Z organic Serper (wyszukiwanie wzmianek domeny) wyciąga NOWE domeny-
// kandydatów na backlinki (nieznane, nie self, nie ignorowane).
// UWAGA: wzmianka ≠ link — wymaga potem weryfikacji linkPresent.
function extractBacklinkCandidates(organic, registry) {
  const known = new Set((registry || []).map(b => normDomain(b.source_domain)));
  const seen = new Set();
  const out = [];
  for (const r of organic || []) {
    const link = r && (r.link || r.url);
    if (!link) continue;
    const dom = normDomain(link);
    if (!dom || isIgnoredSource(dom)) continue;
    if (known.has(dom) || seen.has(dom)) continue;
    seen.add(dom);
    out.push({ source_url: link, source_domain: dom, title: r.title || null });
  }
  return out;
}

module.exports = { linkPresent, diffReferrers, normDomain, extractBacklinkCandidates };
