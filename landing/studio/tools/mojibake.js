'use strict';
// Detekcja i odzyskiwanie mojibake CP1250→UTF-8.
// Wydzielone z server.js, żeby było jednostkowo testowalne (patrz seo-onpage-audit.test.js).
const _iconv = require('iconv-lite');

// Wymaga konkretnych bigramów które pojawiają się TYLKO w mojibake CP1250→UTF-8
// (po prostu Ă/Ä byłoby false-positive na poprawnych znakach jak Ä, Ć, Č).
// - Łacina/PL/DE/ES/IT: Ă³, Ă©, Ă¨, ĂĽ, ĂŁ, Ä…, Ä‡, Ä™, ÄŤ, Ĺ‚, Ĺ›, ĹĽ, Ĺş, Ăź
// - Cyrillic: Đ°-Đż, ĐĽ, ĐĽ, ŃŤ, Ńŕ, Ńŋ
// - CJK po CP1250: ăÂ, ăĽ, ăŤ, ĺ®, ĺ‹, ĺş, ć–, ě», í°
//   UWAGA: follow-chars MUSZĄ być high-Unicode — NIE wolno tu wstawiać U+0022 (zwykły
//   cudzysłow), bo "produktywność"/"gość"/aquí" to legalny tekst, nie mojibake.
// - Smart-quotes: â€™, â€" (bezpieczne — prefiks â€ sam jest mojibake)
// - Replacement char: ďż˝, ???
// - Pathological AI output (np. zwrócone jako tekst slug)
const MOJIBAKE_PATTERN = /(?:Ă[³©¨ĽąŁĽłŻş]|Ä[…‡™ŤĽą]|Ĺ[‚›ĽşĽż]|Ăź|Đ[°-żĽ]|ŃŤ|Ńŕ|Ńŋ|Ń€|ăÂ|ă[ĽŤÂ]|ĺ[®‹ş]|ć–|ě[»–]|í°|â€[™"-]|ďż˝|\?\?\?|cannotreliablyprocess|imunabletogenerate)/i;

const PATHOLOGICAL_RE = /(cannotreliablyprocess|imunabletogenerate|notreadableguide|cannot-process)/i;

function hasBrokenEncoding(value) {
  return MOJIBAKE_PATTERN.test(String(value || ''));
}

// Próba odzyskania mojibake przez round-trip CP1250 → UTF-8.
// Zwraca naprawiony string lub null jeśli odzyskanie zostawiło utracone znaki.
// Mojibake powstaje gdy UTF-8 bytes są odczytane jako CP1250 i zapisane jako UTF-8.
function recoverMojibake(value) {
  const s = String(value || '');
  if (!hasBrokenEncoding(s)) return s;
  try {
    const recovered = _iconv.decode(_iconv.encode(s, 'win1250'), 'utf-8');
    if ((recovered.match(/[�]/g) || []).length >= 2) return null; // utracone znaki
    if (PATHOLOGICAL_RE.test(recovered)) return null; // AI error message
    return recovered;
  } catch {
    return null;
  }
}

module.exports = { MOJIBAKE_PATTERN, PATHOLOGICAL_RE, hasBrokenEncoding, recoverMojibake };
