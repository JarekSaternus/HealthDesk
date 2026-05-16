'use strict';
/**
 * Deterministyczne, word-preserving fixy mechanicznych AI-fingerprintów.
 * Usuwają TYLKO emfazę (**) i powtórzone zdania — nigdy nie zmieniają słów,
 * więc nie wprowadzają nowych wzorców AI. Robione PRZED humanize (AI).
 *
 * Pokrywa wymiary z doAudit: Bold overuse (3), Data/fact repetition (2),
 * Keyword stuffing (10, część — unbold dokładnego keyworda).
 */
function mechanicalDefingerprint(markdown, keyword) {
  let md = String(markdown || '');
  const stats = { dedupedSentences: 0, unboldedKeyword: 0, boldStripped: 0 };

  // (1) Unbold dokładnego primary keyword (**kw** → kw) — sygnał stuffingu.
  if (keyword && String(keyword).trim()) {
    const kwRe = new RegExp(
      `\\*\\*(${String(keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\*\\*`, 'gi');
    md = md.replace(kwRe, (_m, g1) => { stats.unboldedKeyword++; return g1; });
  }

  // (2) Cap bold: zostaw pierwsze N runów **...**, z reszty zdejmij emfazę.
  const words = md.split(/\s+/).filter(Boolean).length;
  const boldCap = Math.max(4, Math.round(words / 350));
  let boldSeen = 0;
  md = md.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, (full, inner) => {
    boldSeen++;
    if (boldSeen <= boldCap) return full;
    stats.boldStripped++;
    return inner;
  });

  // (3) Dedupe identycznych zdań prozy (≥2× → zostaw pierwsze). Pomija
  //     nagłówki/listy/tabele/obrazy/cytaty — tnie tylko powtórzony fakt.
  const lines = md.split('\n');
  const seen = new Set();
  const out = lines.map((line) => {
    const t = line.trim();
    if (!t || /^(#{1,6}\s|[-*>|]|\d+\.\s|!?\[)/.test(t) || t.length < 40) return line;
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((s) => {
      const norm = s.toLowerCase().replace(/[^a-z0-9À-ɏ一-鿿]+/gi, ' ').trim();
      if (norm.length < 30) return true;
      if (seen.has(norm)) { stats.dedupedSentences++; return false; }
      seen.add(norm);
      return true;
    });
    return kept.join(' ');
  });
  md = out.join('\n').replace(/\n{3,}/g, '\n\n');

  const changed = stats.dedupedSentences + stats.unboldedKeyword + stats.boldStripped > 0;
  return { markdown: md, changed, stats };
}

module.exports = { mechanicalDefingerprint };
