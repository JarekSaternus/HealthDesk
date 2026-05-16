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
    if (!src || IGNORED_SOURCES.has(src) || src.endsWith(SELF)) continue;
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

module.exports = { linkPresent, diffReferrers, normDomain };
