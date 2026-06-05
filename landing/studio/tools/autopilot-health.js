'use strict';
// Wykrywanie "cichej śmierci" autopilota: N kolejnych runów schedulera = całkowita porażka.
// Geneza: 2026-06-01 autopilot przez 11 dni co godzinę failował walidację (mojibake
// false-positive), a zwykłe per-run powiadomienie "0/1" ginęło w szumie. Ten moduł daje
// wyróżniający się, eskalujący alert. Czysta logika (bez I/O) — jednostkowo testowana.

const FAIL_THRESHOLD = 3; // tyle porażek z rzędu = pierwszy alert (scheduler tika co 1h → ~3h)
const ALERT_REPEAT = 6;   // potem przypominaj co tyle kolejnych porażek (anti-spam)

// Run = całkowita porażka, gdy nic nie opublikowano (completed===0) a były błędy.
// `errors` liczymy z pola lub z results[] (różne ścieżki schedulera logują nieco inaczej).
function isTotalFailure(run) {
  if (!run || typeof run !== 'object') return false;
  const completed = run.completed || 0;
  const errors = (run.errors != null)
    ? run.errors
    : (Array.isArray(run.results) ? run.results.filter(r => r && r.status === 'error').length : 0);
  return completed === 0 && errors > 0;
}

// Liczba kolejnych porażek licząc od najnowszego runu + kontekst najświeższego błędu.
function countConsecutiveFailures(runs) {
  if (!Array.isArray(runs)) return { count: 0, keyword: null, lang: null, error: null };
  let count = 0, keyword = null, lang = null, error = null;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (!isTotalFailure(runs[i])) break;
    count++;
    if (count === 1) {
      const errRes = (runs[i].results || []).find(r => r && r.status === 'error');
      if (errRes) { keyword = errRes.keyword || null; lang = errRes.lang || null; error = errRes.error || null; }
    }
  }
  return { count, keyword, lang, error };
}

// Czy odpalić alert dla danej liczby kolejnych porażek.
// Anti-spam: tylko dokładnie na progu, a potem co `repeat` kolejnych (np. 3, 9, 15…).
function shouldAlert(count, threshold = FAIL_THRESHOLD, repeat = ALERT_REPEAT) {
  if (count < threshold) return false;
  return count === threshold || (count - threshold) % repeat === 0;
}

const DISABLED_ALERT_COOLDOWN_MS = 6 * 3600 * 1000; // 6h między przypomnieniami o wyłączonym autopilocie

// Drugi tryb awarii (oprócz kolejnych porażek): autopilot WYŁĄCZONY (auto_enabled=false),
// mimo że w kolejce wciąż są zaplanowane keywordy. Scheduler robi wtedy `return` na starcie
// i NIE loguje runu → alert per-run (countConsecutiveFailures) go NIE złapie. Geneza:
// 2026-06-04/06-05 — bug w findNextBatch wyłączał auto, gdy batch był pusty tylko dlatego,
// że oba języki już dziś publikowały (a kolejka pełna). Ten predykat to siatka bezpieczeństwa
// na każdą przyczynę (bug, ręczne wyłączenie) — woła alert zamiast cichego stania.
function isStalledDisabled(autoEnabled, scheduledRemaining) {
  return autoEnabled === false && scheduledRemaining > 0;
}

// Anti-spam dla alertu o wyłączonym autopilocie: scheduler tika co ~1h, więc bez cooldownu
// alarmowałby co godzinę. Pierwszy alert zawsze, potem nie częściej niż co `cooldownMs`.
// Czas wstrzykiwany (now/lastAlertAt jako ms) → czyste i testowalne.
function shouldAlertDisabled(lastAlertAt, now, cooldownMs = DISABLED_ALERT_COOLDOWN_MS) {
  if (lastAlertAt == null) return true;
  return (now - lastAlertAt) >= cooldownMs;
}

module.exports = {
  FAIL_THRESHOLD, ALERT_REPEAT, DISABLED_ALERT_COOLDOWN_MS,
  isTotalFailure, countConsecutiveFailures, shouldAlert,
  isStalledDisabled, shouldAlertDisabled,
};
