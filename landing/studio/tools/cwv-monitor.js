'use strict';
/**
 * CWV monitoring per template (Warstwa techniczna).
 * Czysta logika: parsuje odpowiedź PageSpeed Insights API i wykrywa regresje
 * względem poprzedniego snapshotu. Landing jest statyczny → mierzymy 1
 * reprezentatywny URL na typ szablonu (landing / blog-post / blog-index).
 *
 * Progi Google Core Web Vitals (good): LCP ≤2500ms, INP ≤200ms, CLS ≤0.1.
 */

const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },   // ms
  inp: { good: 200, poor: 500 },     // ms
  cls: { good: 0.1, poor: 0.25 },    // unitless
};

// Wyciąga metryki z odpowiedzi PSI v5 (field data CrUX; fallback lab Lighthouse).
function parsePsi(psi) {
  const out = { source: null, lcp: null, inp: null, cls: null };
  const le = psi && psi.loadingExperience && psi.loadingExperience.metrics;
  if (le) {
    out.source = 'field';
    if (le.LARGEST_CONTENTFUL_PAINT_MS) out.lcp = le.LARGEST_CONTENTFUL_PAINT_MS.percentile;
    if (le.INTERACTION_TO_NEXT_PAINT) out.inp = le.INTERACTION_TO_NEXT_PAINT.percentile;
    if (le.CUMULATIVE_LAYOUT_SHIFT_SCORE) out.cls = le.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100;
  }
  // Fallback / uzupełnienie z lab (Lighthouse) jeśli brak field data
  const a = psi && psi.lighthouseResult && psi.lighthouseResult.audits;
  if (a) {
    if (out.lcp == null && a['largest-contentful-paint']) { out.source = out.source || 'lab'; out.lcp = Math.round(a['largest-contentful-paint'].numericValue); }
    if (out.cls == null && a['cumulative-layout-shift']) { out.source = out.source || 'lab'; out.cls = +a['cumulative-layout-shift'].numericValue.toFixed(3); }
    if (out.inp == null && a['total-blocking-time']) { out.source = out.source || 'lab'; out.tbt = Math.round(a['total-blocking-time'].numericValue); }
  }
  return out;
}

function rate(metric, value) {
  if (value == null) return 'n/a';
  const t = THRESHOLDS[metric];
  if (!t) return 'n/a';
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

function assess(metrics) {
  return {
    lcp: { value: metrics.lcp, rating: rate('lcp', metrics.lcp) },
    inp: { value: metrics.inp, rating: rate('inp', metrics.inp) },
    cls: { value: metrics.cls, rating: rate('cls', metrics.cls) },
    source: metrics.source,
  };
}

// Regresja vs poprzedni snapshot tego samego template (>15% pogorszenia
// albo zejście z 'good' do gorszego ratingu).
function detectRegression(prev, cur) {
  if (!prev) return [];
  const reg = [];
  for (const m of ['lcp', 'inp', 'cls']) {
    const p = prev[m] && prev[m].value, c = cur[m] && cur[m].value;
    if (p == null || c == null) continue;
    const worsePct = p > 0 ? (c - p) / p : 0;
    const ratingDropped = prev[m].rating === 'good' && cur[m].rating !== 'good';
    if (ratingDropped || worsePct > 0.15) {
      reg.push(`${m.toUpperCase()} ${p}→${c} (${ratingDropped ? `rating ${prev[m].rating}→${cur[m].rating}` : `+${Math.round(worsePct * 100)}%`})`);
    }
  }
  return reg;
}

module.exports = { parsePsi, assess, detectRegression, THRESHOLDS };
