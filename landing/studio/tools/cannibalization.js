'use strict';
/**
 * Cannibalization detector (upgrade ponad bazowy slug-token w Warstwie C).
 * Wejście: wiersze GSC z dimensions ['query','page'] —
 *   { keys: [query, page], impressions, clicks, position }
 * Wykrywa zapytania, na które rankuje ≥2 NASZYCH URL z sensownym ruchem
 * i podobnym intentem → kandydat merge/canonical/redystrybucja linków.
 *
 * detectCannibalization(rows, opts) → [{ query, impressions, pages:[{url,impressions,clicks,position}],
 *   severity, recommendation }]
 */

const MIN_QUERY_IMPRESSIONS = 15;   // łączne impresje zapytania
const MIN_PAGE_IMPRESSIONS = 3;     // próg na pojedynczą stronę by liczyć ją jako konkurującą
const MIN_PAGES = 2;

function detectCannibalization(rows, opts = {}) {
  const minQ = opts.minQueryImpressions ?? MIN_QUERY_IMPRESSIONS;
  const minP = opts.minPageImpressions ?? MIN_PAGE_IMPRESSIONS;

  const byQuery = new Map();
  for (const r of rows || []) {
    const q = r.keys && r.keys[0];
    const page = r.keys && r.keys[1];
    if (!q || !page) continue;
    if (!byQuery.has(q)) byQuery.set(q, []);
    byQuery.get(q).push({
      url: page,
      impressions: r.impressions || 0,
      clicks: r.clicks || 0,
      position: r.position || 0,
    });
  }

  const out = [];
  for (const [query, pages] of byQuery) {
    const competing = pages.filter(p => p.impressions >= minP);
    if (competing.length < MIN_PAGES) continue;
    const totalImpr = competing.reduce((s, p) => s + p.impressions, 0);
    if (totalImpr < minQ) continue;

    competing.sort((a, b) => a.position - b.position); // najlepsza pozycja pierwsza
    const best = competing[0];
    const worst = competing[competing.length - 1];
    // severity: więcej stron + obie/wiele blisko top = poważniejsze rozmycie
    const inTop20 = competing.filter(p => p.position > 0 && p.position <= 20).length;
    const severity = (competing.length >= 3 || inTop20 >= 2) ? 'high' : 'medium';

    out.push({
      query,
      impressions: totalImpr,
      pages: competing,
      severity,
      recommendation: severity === 'high'
        ? `Skonsoliduj: wybierz canonical (najlepszy: ${best.url} @${best.position.toFixed(1)}), przekieruj/odlinkuj słabsze, przekieruj internal links na canonical`
        : `Zróżnicuj intent słabszej strony (${worst.url}) albo dodaj internal link z niej do mocniejszej (${best.url})`,
    });
  }
  out.sort((a, b) => (b.severity === 'high') - (a.severity === 'high') || b.impressions - a.impressions);
  return out;
}

module.exports = { detectCannibalization, MIN_QUERY_IMPRESSIONS };
