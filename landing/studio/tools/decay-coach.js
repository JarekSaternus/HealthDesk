'use strict';
/**
 * Warstwa F — Content Decay detector.
 * Czysta logika (bez I/O): porównuje dwa okna GSC (bieżące 28d vs poprzednie 28d)
 * per URL i wykrywa rozpad treści.
 *
 * Reguły (trigger gdy age>180d ORAZ był sensowny ruch wcześniej ORAZ ≥1 z):
 *  - impressions ↓ > 25%
 *  - avg_position pogorszona o > 3 (większa liczba = gorzej)
 *  - CTR ↓ > 20% (względnie)
 *
 * detectDecay(curRows, prevRows, ageDaysByUrl) → [{url, reasons[], severity, before, after}]
 * Wiersz GSC: { keys:[url], impressions, clicks, ctr, position }
 */

const MIN_PREV_IMPRESSIONS = 10;
const IMPR_DROP = 0.25;
const POS_WORSEN = 3;
const CTR_DROP = 0.20;
const MIN_AGE_DAYS = 180;

function toMap(rows) {
  const m = {};
  for (const r of rows || []) {
    const url = r.keys && r.keys[0];
    if (!url) continue;
    m[url] = {
      impressions: r.impressions || 0,
      clicks: r.clicks || 0,
      ctr: r.ctr || 0,
      position: r.position || 0,
    };
  }
  return m;
}

function detectDecay(curRows, prevRows, ageDaysByUrl = {}) {
  const cur = toMap(curRows);
  const prev = toMap(prevRows);
  const out = [];

  for (const url of Object.keys(prev)) {
    const p = prev[url];
    const c = cur[url] || { impressions: 0, clicks: 0, ctr: 0, position: 0 };
    if (p.impressions < MIN_PREV_IMPRESSIONS) continue;

    const age = ageDaysByUrl[url];
    if (age != null && age < MIN_AGE_DAYS) continue; // świeży → naturalna fluktuacja, nie decay

    const reasons = [];
    const imprDrop = (p.impressions - c.impressions) / p.impressions;
    if (imprDrop > IMPR_DROP) reasons.push(`impr ↓${Math.round(imprDrop * 100)}% (${p.impressions}→${c.impressions})`);

    if (p.position > 0 && c.position > 0 && (c.position - p.position) > POS_WORSEN) {
      reasons.push(`pozycja ↓${(c.position - p.position).toFixed(1)} (${p.position.toFixed(1)}→${c.position.toFixed(1)})`);
    }
    if (p.ctr > 0) {
      const ctrDrop = (p.ctr - c.ctr) / p.ctr;
      if (ctrDrop > CTR_DROP && p.clicks >= 1) reasons.push(`CTR ↓${Math.round(ctrDrop * 100)}% (${(p.ctr * 100).toFixed(1)}%→${(c.ctr * 100).toFixed(1)}%)`);
    }

    if (reasons.length) {
      out.push({
        url,
        age_days: age ?? null,
        reasons,
        severity: reasons.length >= 2 ? 'high' : 'medium',
        before: p,
        after: c,
      });
    }
  }
  // sort: high first, potem największy spadek impresji
  out.sort((a, b) => (b.severity === 'high') - (a.severity === 'high') || (b.before.impressions - b.after.impressions) - (a.before.impressions - a.after.impressions));
  return out;
}

module.exports = { detectDecay, MIN_AGE_DAYS, MIN_PREV_IMPRESSIONS };
