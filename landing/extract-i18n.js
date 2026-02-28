#!/usr/bin/env node
/**
 * Extract i18n translations from index.html's T{} object into separate JSON files.
 * Also extracts PL strings from data-i18n elements in the HTML.
 * Run: node extract-i18n.js
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Extract the T = { ... } object from the script
const tMatch = html.match(/var T = \{([\s\S]*?)\n\s*\};/);
if (!tMatch) {
  console.error('Could not find T object in index.html');
  process.exit(1);
}

// We need to extract each language block. The T object has structure:
// en: { ... }, de: { ... }, etc.
// Let's use a different approach — eval the object in a sandboxed way

// Extract the full script block containing T
const scriptMatch = html.match(/var T = \{([\s\S]*?)\n\s{4}\};/);
if (!scriptMatch) {
  console.error('Could not find T block');
  process.exit(1);
}

// Build the T object by evaluating it
const tBlock = 'var T = {' + scriptMatch[1] + '\n    };';
let T;
try {
  T = new Function(tBlock + '; return T;')();
} catch (e) {
  console.error('Failed to parse T object:', e.message);
  process.exit(1);
}

console.log('Found languages:', Object.keys(T).join(', '));

// Extract PL strings from data-i18n elements in HTML
const plStrings = {};
const dataI18nRegex = /data-i18n="([^"]+)"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)/g;
let match;

// More precise extraction: find elements with data-i18n and capture their innerHTML
// We need the original PL content from the HTML
const bodyContent = html.split('<body>')[1].split('</body>')[0];

// Simple regex to get text content of data-i18n elements
const i18nPattern = /data-i18n="([^"]+)"[^>]*>([\s\S]*?)(?=<\/(?:span|h[1-6]|p|a|div|td|li|button))/g;
while ((match = i18nPattern.exec(bodyContent)) !== null) {
  const key = match[1];
  let value = match[2].trim();
  // Skip dynamic keys
  if (key.includes('-dynamic')) continue;
  if (value && !plStrings[key]) {
    plStrings[key] = value;
  }
}

// Add breathing animation strings (hardcoded in PL)
plStrings['breathing.inhale'] = 'Wdech';
plStrings['breathing.hold'] = 'Zatrzymaj';
plStrings['breathing.exhale'] = 'Wydech';
plStrings['breathing.cycle'] = 'Cykl {{current}} / {{total}}';

// Build PL from HTML originals + what EN has (as reference for all keys)
const enKeys = Object.keys(T.en || {});
const pl = {};
for (const key of enKeys) {
  pl[key] = plStrings[key] || key; // fallback to key name if not found
}

// Manual PL translations for all keys (extracted from HTML content)
const plManual = {
  'nav.features': 'Funkcje',
  'nav.how': 'Jak działa',
  'nav.why': 'Dlaczego',
  'nav.comparison': 'Porównanie',
  'nav.download': 'Pobierz',
  'hero.badge': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Darmowa aplikacja — Windows, macOS, Linux',
  'hero.title': 'Twoje oczy, kręgosłup i głowa <span class="accent">Ci podziękują</span>',
  'hero.subtitle': 'Inteligentne przerwy, nawodnienie, ćwiczenia oczu i śledzenie aktywności — wszystko w jednej lekkiej aplikacji, która działa w tle.',
  'dl.btn': 'Pobierz',
  'hero.no_account': 'Bez konta, bez rejestracji',
  'mini.next_break': 'Następna przerwa za',
  'mini.breaks': 'Przerwy',
  'mini.water': 'Woda',
  'mini.work': 'Praca',
  'feat.title': 'Co robi HealthDesk?',
  'feat.subtitle': 'Kluczowe funkcje + jeszcze więcej — wszystko, czego potrzebujesz do zdrowej pracy przy komputerze.',
  'feat.breaks.t': 'Inteligentne przerwy',
  'feat.breaks.d': '<strong>4 metody pracy do wyboru:</strong> Pomodoro, 20-20-20, 52-17 i 90-minutowa. Inteligentna ochrona przerw — przypomnienia nigdy się nie nakładają.',
  'feat.water.t': 'Przypomnienia o wodzie',
  'feat.water.d': '<strong>Cel: 8 szklanek dziennie.</strong> Delikatne przypomnienia co 30 minut. Śledź postępy i buduj nawyk.',
  'feat.eyes.t': 'Ćwiczenia oczu',
  'feat.eyes.d': '<strong>Prowadzone sesje z timerem.</strong> Ruch gałkami, mruganie, zmiana fokusu — redukcja zmęczenia wzroku.',
  'feat.more': 'I jeszcze więcej',
  'feat.track.t': 'Śledzenie aktywności',
  'feat.track.d': '<strong>Automatyczna kategoryzacja aplikacji</strong> na pracę, rozrywkę, komunikację i naukę.',
  'feat.audio.t': 'Dźwięki do skupienia',
  'feat.audio.d': '<strong>Brown noise, deszcz, las, ocean</strong> — generowane w czasie rzeczywistym.',
  'feat.radio.t': 'YouTube Radio + FM',
  'feat.radio.d': '<strong>6 stacji YT + 6 stacji FM</strong> (RMF, Antyradio, ZET, Eska). Pauza wstrzymuje muzykę razem z timerami.',
  'feat.breath.t': 'Trening oddechowy',
  'feat.breath.d': '<strong>Box breathing 4-4-4-4</strong> z animowanym kołem. Zredukuj stres w 60 sekund.',
  'feat.stretch.t': 'Rozciąganie',
  'feat.stretch.d': '<strong>Prowadzone ćwiczenia</strong> na szyję, ramiona i plecy — krok po kroku z timerem.',
  'feat.idle.t': 'Smart Idle + DND',
  'feat.idle.d': '<strong>Wykrywa bezczynność i Focus Assist.</strong> Timery zamrażają się gdy odchodzisz. Zero popupów gdy Windows DND aktywny.',
  'preview.title': 'Zobacz jak wygląda',
  'preview.subtitle': 'Ciemny, elegancki interfejs, który nie rozprasza — dostarcza informacje na pierwszy rzut oka.',
  'how.title': 'Jak to działa?',
  'how.subtitle': 'Trzy proste kroki do zdrowszej pracy przy komputerze.',
  'how.s1.t': 'Zainstaluj',
  'how.s1.d': 'Pobierz instalator, kliknij dalej i gotowe. Bez konta, bez rejestracji.',
  'how.s2.t': 'Pracuj normalnie',
  'how.s2.d': 'HealthDesk działa w tle. Nie zauważysz go, dopóki nie nadejdzie pora na przerwę.',
  'how.s3.t': 'Odpoczywaj regularnie',
  'how.s3.d': 'Reaguj na przypomnienia. Twoje oczy i kręgosłup będą Ci wdzięczne.',
  'why.title': 'Dlaczego warto?',
  'why.subtitle': 'Nawyki poparte badaniami naukowymi.',
  'why.s1.t': 'Regularne przerwy',
  'why.s1.d': 'Krótkie przerwy co 25–52 minuty zwiększają produktywność o 13% i zmniejszają zmęczenie psychiczne.',
  'why.s1.src': 'Źródło: DeskTime Productivity Research (2023)',
  'why.s2.t': 'Wody dziennie',
  'why.s2.d': 'Regularne nawadnianie poprawia koncentrację i zmniejsza bóle głowy.',
  'why.s2.src': 'Źródło: European Food Safety Authority (EFSA)',
  'why.s3.t': 'Ćwiczeń i rozciągania',
  'why.s3.d': 'Krótkie przerwy na ruch zapobiegają bólom pleców i poprawiają krążenie.',
  'why.s3.src': 'Źródło: WHO Guidelines on Physical Activity (2020)',
  'cmp.title': 'Jak wypada HealthDesk?',
  'cmp.subtitle': 'Szczere porównanie z popularnymi alternatywami.',
  'cmp.g.basics': 'Podstawy',
  'cmp.platforms': 'Platformy',
  'cmp.price': 'Cena',
  'cmp.free': 'Darmowy',
  'cmp.g.breaks': 'Przerwy i metodyki',
  'cmp.break_types': 'Typy przerw',
  'cmp.big_small': 'Duże + małe',
  'cmp.methods': 'Metodyki pracy',
  'cmp.manual': 'Ręczna konfiguracja',
  'cmp.pom_only': 'Tylko Pomodoro 25/5',
  'cmp.snooze': 'Snooze / odłóż',
  'cmp.g.health': 'Zdrowie i ćwiczenia',
  'cmp.water': 'Przypomnienia o wodzie',
  'cmp.eye_ex': 'Ćwiczenia oczu',
  'cmp.animated': 'Animowane',
  'cmp.stretch': 'Rozciąganie',
  'cmp.text_only': 'Tylko tekst',
  'cmp.breathing': 'Trening oddechowy',
  'cmp.g.prod': 'Produktywność',
  'cmp.6sounds': '6 dźwięków + YT Radio',
  'cmp.white_noise': 'Biały szum',
  'cmp.tracking': 'Śledzenie aktywności',
  'cmp.auto': 'Automatyczne',
  'cmp.daily_limit': 'Limit dzienny',
  'cmp.stats': 'Statystyki',
  'cmp.multi_period': 'Wielookresowe',
  'cmp.basic': 'Podstawowe',
  'cmp.g.perf': 'Wydajność aplikacji',
  'cmp.installer_size': 'Rozmiar instalatora',
  'cmp.ram': 'Zużycie RAM',
  'cmp.footer': 'Dane na podstawie wersji dostępnych w lutym 2026. Rozmiar i RAM mogą się różnić w zależności od platformy.',
  'cta.title': 'Gotowy na zdrowszą pracę?',
  'cta.subtitle': 'Zainstaluj za darmo i zacznij dbać o siebie — od pierwszej przerwy.',
  'cta.download': 'Pobierz za darmo',
  'cta.no_ads': 'Bez reklam, bez konta',
  'faq.title': 'Często zadawane pytania',
  'faq.q1': 'Czy HealthDesk jest darmowy?',
  'faq.a1': 'Tak, całkowicie darmowy. Bez ukrytych opłat, subskrypcji czy premium. Wszystkie funkcje dostępne od razu.',
  'faq.q2': 'Czy aplikacja zbiera moje dane?',
  'faq.a2': 'Statystyki, przerwy i nawodnienie przechowywane są lokalnie na Twoim komputerze. Aplikacja wysyła anonimowe dane telemetryczne (UUID instalacji, zdarzenia użytkowania, wersja systemu) w celu poprawy jakości produktu. Możesz to wyłączyć w Ustawieniach &gt; System &gt; Anonimowa telemetria. Nie zbieramy żadnych danych osobowych.',
  'faq.q3': 'Czy HealthDesk działa offline?',
  'faq.a3': 'Tak — przerwy, ćwiczenia, woda, aktywność i dźwięki działają offline. Tylko YouTube Radio wymaga internetu.',
  'faq.q4': 'Czy mogę dostosować częstotliwość przerw?',
  'faq.a4': 'Tak. Wybierz gotową metodę pracy (Pomodoro, 20-20-20, 52-17, 90-minutowa) lub ustaw własne interwały. Częstotliwość przerw, przypomnienia o wodzie, godziny pracy — wszystko konfigurowalne w ustawieniach.',
  'faq.q5': 'Jak odinstalować aplikację?',
  'faq.q6': 'Ile waży instalator?',
  'faq.q7': 'Windows pokazuje niebieski ekran przy instalacji?',
  'modal.title': 'Przed instalacją',
  'modal.subtitle': 'Aplikacja jest bezpieczna i <a href="https://github.com/JarekSaternus/HealthDesk" target="_blank">open source</a>. System może wymagać dodatkowego kroku.',
  'modal.dl_now': 'Pobierz teraz',
  'mock.small_break': 'Mała przerwa',
  'mock.break_desc': 'Odwróć wzrok od ekranu i patrz<br>na obiekt oddalony o ~6 metrów.',
  'mock.take_break': 'Robię przerwę!',
  'mock.skip': 'Pomiń',
  'footer.privacy': 'Polityka prywatności',
  'footer.copy': '© 2026 HealthDesk. Wszelkie prawa zastrzeżone.',
  // Breathing animation
  'breathing.inhale': 'Wdech',
  'breathing.hold': 'Zatrzymaj',
  'breathing.exhale': 'Wydech',
  'breathing.cycle': 'Cykl {{current}} / {{total}}'
};

// Add breathing keys to all languages
const breathingKeys = {
  en: { 'breathing.inhale': 'Inhale', 'breathing.hold': 'Hold', 'breathing.exhale': 'Exhale', 'breathing.cycle': 'Cycle {{current}} / {{total}}' },
  de: { 'breathing.inhale': 'Einatmen', 'breathing.hold': 'Halten', 'breathing.exhale': 'Ausatmen', 'breathing.cycle': 'Zyklus {{current}} / {{total}}' },
  es: { 'breathing.inhale': 'Inhalar', 'breathing.hold': 'Mantener', 'breathing.exhale': 'Exhalar', 'breathing.cycle': 'Ciclo {{current}} / {{total}}' },
  fr: { 'breathing.inhale': 'Inspirer', 'breathing.hold': 'Retenir', 'breathing.exhale': 'Expirer', 'breathing.cycle': 'Cycle {{current}} / {{total}}' },
  'pt-BR': { 'breathing.inhale': 'Inspirar', 'breathing.hold': 'Segurar', 'breathing.exhale': 'Expirar', 'breathing.cycle': 'Ciclo {{current}} / {{total}}' },
  ja: { 'breathing.inhale': '吸う', 'breathing.hold': '止める', 'breathing.exhale': '吐く', 'breathing.cycle': 'サイクル {{current}} / {{total}}' },
  'zh-CN': { 'breathing.inhale': '吸气', 'breathing.hold': '屏住', 'breathing.exhale': '呼气', 'breathing.cycle': '循环 {{current}} / {{total}}' },
  ko: { 'breathing.inhale': '들이쉬기', 'breathing.hold': '멈추기', 'breathing.exhale': '내쉬기', 'breathing.cycle': '사이클 {{current}} / {{total}}' },
  it: { 'breathing.inhale': 'Inspira', 'breathing.hold': 'Trattieni', 'breathing.exhale': 'Espira', 'breathing.cycle': 'Ciclo {{current}} / {{total}}' },
  tr: { 'breathing.inhale': 'Nefes al', 'breathing.hold': 'Tut', 'breathing.exhale': 'Nefes ver', 'breathing.cycle': 'Döngü {{current}} / {{total}}' },
  ru: { 'breathing.inhale': 'Вдох', 'breathing.hold': 'Задержка', 'breathing.exhale': 'Выдох', 'breathing.cycle': 'Цикл {{current}} / {{total}}' },
};

// Write PL
const outDir = path.join(__dirname, 'src', 'i18n');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'pl.json'), JSON.stringify(plManual, null, 2), 'utf8');
console.log('Written: pl.json (' + Object.keys(plManual).length + ' keys)');

// Write other languages
for (const [lang, translations] of Object.entries(T)) {
  const merged = { ...translations, ...(breathingKeys[lang] || {}) };
  fs.writeFileSync(path.join(outDir, lang + '.json'), JSON.stringify(merged, null, 2), 'utf8');
  console.log('Written: ' + lang + '.json (' + Object.keys(merged).length + ' keys)');
}

console.log('\nDone! Files written to landing/src/i18n/');
