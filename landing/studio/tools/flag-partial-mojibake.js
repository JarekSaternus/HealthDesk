// Oznacza keywordy z PARTIAL mojibake (nieodzyskiwalne CJK/cyrylica) jako
// status='error' z notatką, żeby scheduler ich nie próbował w przyszłości.
// User może je później ręcznie zastąpić nowymi keywordami.
//
// Użycie:
//   node tools/flag-partial-mojibake.js          # DRY RUN
//   node tools/flag-partial-mojibake.js --apply

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const STUDIO_JSON = path.join(__dirname, '..', 'studio.json');
const APPLY = process.argv.includes('--apply');

const MOJIBAKE_RE = /[ĂĐăĺěĹŃťĽşżš][^\s]*[ĂĐăĺěĹŃťĽşżš]|[ăĺ][†‡‹•–—™œ¬®]|[ŃĐ][ľľĐ]/;
function looksLikeMojibake(s) {
  return typeof s === 'string' && MOJIBAKE_RE.test(s);
}

function recover(s) {
  try {
    const bytes = iconv.encode(s, 'win1250');
    return iconv.decode(bytes, 'utf-8');
  } catch { return s; }
}

const data = JSON.parse(fs.readFileSync(STUDIO_JSON, 'utf8'));
const clusters = (data.content_calendar || {}).clusters || [];

const flagged = [];
for (const c of clusters) {
  for (const [lang, kws] of Object.entries(c.keywords || {})) {
    for (const k of kws) {
      if (k.status === 'published') continue;     // nie ruszaj opublikowanych
      if (k.status === 'error') continue;          // już oflagowane
      if (!looksLikeMojibake(k.keyword)) continue;
      const recovered = recover(k.keyword);
      const lossCount = (recovered.match(/[�?]/g) || []).length;
      if (lossCount <= 2) continue; // OK recovery — pomiń
      flagged.push({ cluster: c.id || c.name, lang, kw: k, recovered, lossCount });
    }
  }
}

console.log(`PARTIAL mojibake do oflagowania: ${flagged.length}`);
const byLang = {};
for (const f of flagged) byLang[f.lang] = (byLang[f.lang] || 0) + 1;
console.log('Per-lang:', byLang);
console.log();
console.log('=== PRZYKŁADY (pierwsze 10) ===');
for (const f of flagged.slice(0, 10)) {
  console.log(`[${f.lang}/${f.kw.status}] loss=${f.lossCount}`);
  console.log(`  before: ${f.kw.keyword.slice(0, 70)}`);
  console.log(`  partial: ${f.recovered.slice(0, 70)}`);
}

if (!APPLY) {
  console.log('\n[DRY RUN] --apply zmieni status na "error" + doda notatkę.');
  process.exit(0);
}

const backupPath = STUDIO_JSON + '.bak.partial-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
fs.copyFileSync(STUDIO_JSON, backupPath);

let changed = 0;
const today = new Date().toISOString().slice(0, 10);
for (const f of flagged) {
  f.kw.status = 'error';
  f.kw.last_error = `PARTIAL mojibake (${f.lossCount} utraconych znaków po CP1250 round-trip) — wymaga ręcznej korekty. Flagged ${today}.`;
  changed++;
}

fs.writeFileSync(STUDIO_JSON, JSON.stringify(data, null, 2), 'utf8');
console.log(`\nBackup: ${backupPath}`);
console.log(`Oflagowano: ${changed} keywordów → status='error'.`);
console.log('Scheduler ich teraz pominie. User może je ręcznie zastąpić nowymi keywordami w klastrach.');
