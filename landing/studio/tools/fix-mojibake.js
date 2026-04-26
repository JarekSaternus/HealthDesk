// Fix mojibake in studio.json keywords (CP1250 round-trip).
//
// Mojibake powstał gdy UTF-8 bytes zostały odczytane jako CP1250 i zapisane
// jako UTF-8 — odwrotny round-trip (encode jako win1250 → decode jako utf-8)
// odzyskuje oryginalny tekst.
//
// Usage:
//   node tools/fix-mojibake.js          # DRY RUN — pokazuje zmiany
//   node tools/fix-mojibake.js --apply  # zapisuje zmiany + backup
//
// Dotyczy keywordów w content_calendar.clusters[].keywords[lang][].keyword

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const STUDIO_JSON = path.join(__dirname, '..', 'studio.json');
const APPLY = process.argv.includes('--apply');

// Heurystyka: ciąg zawiera typowe znaki mojibake CP1250→UTF-8
// `Ă` (0xC4 0x82), `Đ` (0xC4 0x90), `ă` (0xC4 0x83), `ĺ` (0xC4 0xBA),
// `ě` (0xC4 0x9B), `Ĺ` (0xC4 0xB9), `Ń` (0xC5 0x83), `ť` (0xC5 0xA5),
// `Ľ` (0xC4 0xBD), `ş` (0xC5 0x9F), `ż` (0xC5 0xBC), `š` (0xC5 0xA1).
const MOJIBAKE_RE = /[ĂĐăĺěĹŃťĽşżš][^\s]*[ĂĐăĺěĹŃťĽşżš]|[ăĺ][†‡‹•–—™œ¬®]|[ŃĐ][ľľĐ]/;

function looksLikeMojibake(s) {
  return typeof s === 'string' && MOJIBAKE_RE.test(s);
}

function recover(s) {
  try {
    const bytes = iconv.encode(s, 'win1250');
    return iconv.decode(bytes, 'utf-8');
  } catch {
    return s;
  }
}

const data = JSON.parse(fs.readFileSync(STUDIO_JSON, 'utf8'));
const clusters = (data.content_calendar || {}).clusters || [];

const changes = [];
let totalKws = 0;

for (const cluster of clusters) {
  for (const [lang, kws] of Object.entries(cluster.keywords || {})) {
    for (const k of kws) {
      totalKws++;
      const before = k.keyword;
      if (!looksLikeMojibake(before)) continue;
      const after = recover(before);
      if (after === before) continue;
      // Reject if recovery still has unrecoverable chars (>2 question marks or replacement)
      const lossCount = (after.match(/[�?]/g) || []).length;
      const status = lossCount > 2 ? 'PARTIAL' : 'OK';
      changes.push({
        cluster: cluster.id || cluster.name,
        lang,
        status_kw: k.status,
        before,
        after,
        loss: lossCount,
        result: status,
        ref: k
      });
    }
  }
}

console.log(`Łącznie keywordów: ${totalKws}`);
console.log(`Wykryto mojibake: ${changes.length}`);
console.log(`  OK (czyste odzyskanie):     ${changes.filter(c => c.result === 'OK').length}`);
console.log(`  PARTIAL (część utracona):   ${changes.filter(c => c.result === 'PARTIAL').length}`);
console.log();

const byLang = {};
for (const c of changes) byLang[c.lang] = (byLang[c.lang] || 0) + 1;
console.log('Per-lang:', byLang);
console.log();

console.log('=== PRZYKŁADY (pierwsze 15 OK) ===');
for (const c of changes.filter(c => c.result === 'OK').slice(0, 15)) {
  console.log(`[${c.lang}/${c.status_kw}]`);
  console.log(`  - ${c.before}`);
  console.log(`  + ${c.after}`);
}

if (changes.filter(c => c.result === 'PARTIAL').length > 0) {
  console.log('\n=== PARTIAL (może wymagać ręcznej korekty) ===');
  for (const c of changes.filter(c => c.result === 'PARTIAL').slice(0, 10)) {
    console.log(`[${c.lang}/${c.status_kw}] loss=${c.loss}`);
    console.log(`  - ${c.before}`);
    console.log(`  + ${c.after}`);
  }
}

if (!APPLY) {
  console.log('\n[DRY RUN] Uruchom z --apply żeby zapisać zmiany.');
  process.exit(0);
}

// APPLY MODE
const backupPath = STUDIO_JSON + '.bak.' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
fs.copyFileSync(STUDIO_JSON, backupPath);
console.log(`\nBackup: ${backupPath}`);

let applied = 0;
for (const c of changes) {
  if (c.result !== 'OK') continue; // Skip PARTIAL — wymaga decyzji
  c.ref.keyword = c.after;
  applied++;
}

fs.writeFileSync(STUDIO_JSON, JSON.stringify(data, null, 2), 'utf8');
console.log(`Zapisano: ${applied} keywordów naprawionych (PARTIAL pominięte — wymagają ręcznej korekty).`);
