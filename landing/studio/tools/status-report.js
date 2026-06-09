'use strict';
// Diagnostyka blog studio / autopilota — czyta stan z plików (działa też gdy serwer leży)
// i pokazuje czytelny popup. Odpalany przez Harmonogram zadań (logon + logon+2h) — patrz
// Install-StatusReport.ps1. Tymczasowe: jak autopilot będzie stabilny → Uninstall-StatusReport.ps1.
//
// Użycie:
//   node tools/status-report.js            → wypisuje raport na stdout
//   node tools/status-report.js --popup    → dodatkowo pokazuje okienko (MessageBox)

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { execFile } = require('child_process');

const STUDIO_DIR = path.join(__dirname, '..');
const STUDIO_JSON = path.join(STUDIO_DIR, 'studio.json');
const SCHEDULER_LOG = path.join(STUDIO_DIR, 'scheduler_log.json');
const PORT = 4000;

const todayStr = () => new Date().toISOString().slice(0, 10);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return null; }
}

// Czy ktoś nasłuchuje na porcie 4000 (serwer studio żyje?). Jedna próba.
function tryConnect(port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (alive) => { if (!done) { done = true; sock.destroy(); resolve(alive); } };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, '127.0.0.1');
  });
}

// Retry 3×: serwer bywa zajęty publikowaniem (build/deploy/push) i pojedyncza próba może
// chybić → bez retry pokazywalibyśmy fałszywe „serwer padł". Żyje, jeśli choć raz się połączy.
async function checkPort(port) {
  for (let i = 0; i < 3; i++) {
    if (await tryConnect(port, 1200)) return true;
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

// Żywy stan pipeline'u z działającego serwera (GET /api/calendar/status).
// Zwraca obiekt progress lub null (serwer leży / timeout / błąd). Krótki timeout,
// żeby raport nie wisiał gdy serwer jest zajęty publikowaniem.
function fetchLiveStatus(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/calendar/status', timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// Spłaszcza wszystkie keywordy z klastrów do jednej listy z polem lang.
function allKeywords(cal) {
  const out = [];
  for (const cl of (cal.clusters || [])) {
    for (const lang of Object.keys(cl.keywords || {})) {
      for (const kw of (cl.keywords[lang] || [])) out.push({ ...kw, lang });
    }
  }
  return out;
}

function hoursSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3600000;
}

async function buildReport() {
  const now = new Date();
  const stamp = `${now.toLocaleDateString('pl-PL')} ${now.toLocaleTimeString('pl-PL').slice(0, 5)}`;
  const lines = [];
  const alerts = [];

  const serverUp = await checkPort(PORT);
  // Żywy run trzyma blokadę pipeline'u (calendarProgress.status==='running') i jeszcze nie
  // trafił do scheduler_log → bez tego heurystyki czasowe krzyczą „scheduler stoi" choć
  // właśnie publikuje. Pobieramy tylko gdy serwer żyje.
  const live = serverUp ? await fetchLiveStatus(PORT, 1500) : null;
  const liveRunning = !!(live && live.status === 'running');
  const studio = readJson(STUDIO_JSON);
  const cal = studio && studio.content_calendar;
  const log = readJson(SCHEDULER_LOG);
  const runs = (log && Array.isArray(log.runs)) ? log.runs : [];

  lines.push(`HealthDesk Blog Studio — status (${stamp})`);
  lines.push('');

  // SERWER
  lines.push(`SERWER:    ${serverUp ? '✅ działa (port 4000)' : '❌ NIE działa (brak nasłuchu na :4000)'}`);
  if (!serverUp) alerts.push('Serwer studio nie odpowiada — uruchom start-studio.vbs / npm start.');

  if (!cal) {
    lines.push('KOLEJKA:   ❓ nie udało się odczytać studio.json');
    alerts.push('Brak/niepoprawny studio.json — nie wiem co w kolejce.');
    return finalize(lines, alerts);
  }

  // AUTOPILOT
  const auto = cal.auto_enabled === true;
  lines.push(`AUTOPILOT: ${auto ? '✅ włączony' : '⚠️ WYŁĄCZONY'} (interval ${cal.interval_days ?? '?'}d, next_run ${cal.next_run || '—'})`);

  // KOLEJKA
  const kws = allKeywords(cal);
  const scheduled = kws.filter(k => k.status === 'scheduled')
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
  const today = todayStr();
  const overdue = scheduled.filter(k => k.scheduled_date && k.scheduled_date <= today).length;
  lines.push(`KOLEJKA:   ${scheduled.length} zaplanowanych${overdue ? ` (${overdue} zaległych)` : ''}`);
  scheduled.slice(0, 5).forEach(k => lines.push(`   • ${k.lang} ${k.scheduled_date || '—'}  ${k.keyword}`));
  if (scheduled.length > 5) lines.push(`   … i ${scheduled.length - 5} więcej`);

  // Autopilot wyłączony przy niepustej kolejce = cicha śmierć (osobny tryb awarii).
  if (!auto && scheduled.length > 0) {
    alerts.push(`Autopilot WYŁĄCZONY, a w kolejce czeka ${scheduled.length} wpisów — włącz w Studio (auto-toggle).`);
  }

  // OPUBLIKOWANE DZIŚ
  const pubToday = kws.filter(k => k.status === 'published' && k.published_date === today);
  lines.push(`DZIŚ:      ${pubToday.length} opublikowanych`);
  pubToday.slice(0, 5).forEach(k => lines.push(`   • ${k.lang}/${k.slug}`));

  // OSTATNI RUN + historia
  if (runs.length) {
    const last = runs[runs.length - 1];
    const ok = last.completed > 0 && (last.errors || 0) === 0;
    const r0 = (last.results || [])[0] || {};
    lines.push(`OSTATNI RUN: ${String(last.date).replace('T', ' ').slice(0, 16)} — ${ok ? '✅' : '❌'} ${last.completed || 0} ok, ${last.errors || 0} błąd(y)`);
    if (!ok && r0.error) lines.push(`   ↳ ${r0.lang || '?'} "${r0.keyword || '?'}": ${String(r0.error).slice(0, 100)}`);

    // Pasek ostatnich 10 runów
    const bar = runs.slice(-10).map(r => (r.completed > 0 && (r.errors || 0) === 0) ? '✅' : '❌').join('');
    lines.push(`HISTORIA:  ${bar}  (najstarszy→najnowszy)`);

    // N kolejnych porażek od końca
    let fails = 0;
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      if ((r.completed || 0) === 0 && (r.errors || 0) > 0) fails++; else break;
    }
    if (fails >= 3) alerts.push(`${fails} kolejnych runów bez publikacji — autopilot może być zacięty.`);

    // Brak runu mimo zaległości — ALE tylko gdy NIC się akurat nie publikuje. Run w toku
    // trzyma blokadę i nie zalogował się jeszcze, więc „ostatni run X h temu" jest mylące.
    const hrs = hoursSince(last.date);
    if (auto && overdue > 0 && hrs != null && hrs > 3 && !liveRunning) {
      alerts.push(`Są zaległe wpisy, a ostatni run był ${Math.round(hrs)}h temu — scheduler może stać.`);
    }
  } else {
    lines.push('OSTATNI RUN: — brak wpisów w scheduler_log.json');
  }

  // RUN W TOKU — pokazujemy gdy serwer dosłownie teraz publikuje (override fałszywek czasowych).
  if (liveRunning) {
    const kw = live.keyword || '?';
    const lg = live.lang ? `${live.lang} ` : '';
    const step = live.step || 'running';
    lines.push(`TERAZ:     🟢 publikuje: ${lg}${kw} (${step})`);
  }

  return finalize(lines, alerts);
}

function finalize(lines, alerts) {
  lines.push('');
  if (alerts.length) {
    lines.push('⚠️ ALERTY:');
    alerts.forEach(a => lines.push(`   • ${a}`));
  } else {
    lines.push('✅ Brak alertów — wygląda OK.');
  }
  return { text: lines.join('\n'), healthy: alerts.length === 0 };
}

// Popup przez PowerShell MessageBox (Windows). Ikona zależy od zdrowia.
function showPopup(text, healthy) {
  const tmp = path.join(require('os').tmpdir(), `healthdesk-status-${process.pid}.txt`);
  fs.writeFileSync(tmp, text, 'utf-8');
  const icon = healthy ? 'Information' : 'Warning';
  const ps = `Add-Type -AssemblyName System.Windows.Forms | Out-Null; ` +
    `$t = [System.IO.File]::ReadAllText('${tmp.replace(/'/g, "''")}'); ` +
    `[System.Windows.Forms.MessageBox]::Show($t, 'HealthDesk Studio — status', 'OK', '${icon}') | Out-Null; ` +
    `Remove-Item -LiteralPath '${tmp.replace(/'/g, "''")}' -ErrorAction SilentlyContinue`;
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], () => {});
}

(async () => {
  const { text, healthy } = await buildReport();
  console.log(text);
  if (process.argv.includes('--popup')) showPopup(text, healthy);
})();
