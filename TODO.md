# TODO

## Niewydane na masterze (v2.1.0)
- ✅ Autostart fix (#[cfg(not(debug_assertions))])
- ✅ Harmonogram tygodniowy (3 tryby + DayTimeline)
- ✅ Google Calendar OAuth (multi-cal, smart scheduling, pre-meeting reminders)
- ✅ Settings: 4 zakładki (Przerwy, Wellness, Integracje, System)
- ✅ Dashboard: kompaktowy layout
- ✅ Help page: nowe sekcje

## P0 — Blokery
1. **Certum Code Signing** — karta cryptoCertum do kupienia, aktywacja certyfikatu w toku
2. **Weryfikacja Google OAuth** — brand verification ✅ (2026-04-15), zostało: app verification dla sensitive scope `calendar.readonly` (review 1-2 tyg po złożeniu).
   - Scope justification draft gotowy: `docs/google-verification-justification.md`
   - PKCE flow end-to-end zweryfikowany w praktyce ✅ (connect + fetch calendars action w HealthDesk 2026-04-15)
   - **BLOCKER nagrania filmu**: dopisać brakujące klucze i18n — patrz **P1.10** niżej
   - Po i18n: nagrać screencast ~60-90s wg scenariusza z `docs/google-verification-justification.md` (scena 3 MUSI pokazać URL bar + nazwę HealthDesk + opis scope'u), upload YouTube Unlisted, wklej link w Centrum weryfikacji → Potwierdź

## Znaleziska in-session blockery nagrania P0.4

### P1.10 Brakujące klucze i18n — blocker filmu verification
Kod React używa kluczy które nie istnieją w `locales/*.json`, UI pokazuje surowe klucze (`home.good_afternoon`, `status.active` itd.) zamiast przetłumaczonych tekstów. Fallback `t("klucz") || "default"` nie działa, bo `t()` zwraca sam klucz (truthy) gdy go nie znajdzie — trzeba dopisać klucze w plikach locale.

**Brakujące klucze:**
- `home.good_morning`, `home.good_afternoon`, `home.good_evening` (`src/pages/HomeEnhanced.tsx:56-58`)
- `home.daily_goal` (`src/pages/HomeEnhanced.tsx:278`)
- `home.work_method` (`src/pages/HomeEnhanced.tsx:324`)
- `status.active`, `status.elapsed`, `status.pause`, `status.outside_work_hours` (`src/components/BottomBar.tsx:46-52`)
- `status.to_break`, `status.reset_confirm`, `status.reset_yes`, `status.reset_no`, `status.reset_timers` (`src/components/BottomBar.tsx:56-81`)

**Scope:** 12 plików (pl, en, de, es, fr, it, ja, ko, pt-BR, ru, tr, zh-CN) × ~14 kluczy = ~168 tłumaczeń. Mass translate przez Claude + ręczne review PL/EN/DE.

**Dlaczego blocker filmu:** Google scrupulatnie ogląda verification screencasty. UI z surowymi kluczami i18n wygląda jak broken app — ryzyko odrzucenia wniosku + 2 tyg opóźnienia na ponowny review.

**Sugerowany flow:** osobna sesja `/stitch` lub manual — najpierw dopisać do `pl.json` i `en.json` ręcznie (żeby mieć wzorzec), potem Claude wygeneruje pozostałe 10 języków jednym promptem, zweryfikować CJK (ja/ko/zh-CN/pt-BR) ręcznie.
3. Alias privacy@healthdesk.site (panel cyber-folks)
4. ✅ Google Calendar OAuth — PKCE + state + token keyring wdrożone (commit 989932f). Client_secret usunięty z kodu, tokeny w OS keyring zamiast config.json.

## P1 — Duże feature'y
5. YouTube playlisty — import playlist, lista tracków, auto-next, opcja cookies
6. Suwak drag na timeline — ad-hoc przesuwanie przerw (jednorazowe override)

## P2 — UX / quick wins
7. Tooltip godzin pracy
8. Cotygodniowy summary (toast w poniedziałek)
9. Ctrl+Shift+W — globalny skrót na wodę
10. Night mode / wind-down

## P3 — Marketing / growth
11. Reddit post (wymaga code signing)
12. Product Hunt launch
13. Strona porównawcza (vs Stretchly, EyeLeo, Workrave)
14. AlternativeTo, Softpedia — katalogi + backlinki
15. ✅ Blog SEO — audyt 35 postów, naprawione: UTF-8, hreflang, FAQ, slugi, cross-links, reading time
16. ✅ Blog Studio — content calendar (629 kw, 6 klastrów, SERP scoring v2, cluster rotation, reschedule)
17. ✅ Blog autopilot pipeline — AI draft, humanize, grammar, hero image, auto-siblings, AI CJK slugs
18. Pitch do HR — one-pager "HealthDesk dla firm"
19. SEO nice-to-have: Author schema (E-E-A-T), lazy loading images

## P4 — Backend / analytics
20. Web dashboard telemetrii (Chart.js)
21. Blog Studio Analytics (GA4 Data API)
22. Crash reporting — rozbudowa o tracebacki

## Znaleziska Codex — follow-up po blokach 1-4

### P1 (zrobić przy okazji następnej sesji security)
- **P1.7 Token revocation** — `disconnect()` usuwa token lokalnie ale nie woła Google revoke endpoint (`https://oauth2.googleapis.com/revoke`). Przejęty refresh token może dalej działać po wylogowaniu.
- **P1.8 `delete_tokens()` error ignorowany** przez `let _ = delete_tokens()` — cichy fail może zostawić tokeny w keyringu mimo "wylogowania". Propaguj błąd lub przynajmniej loguj jako error.
- **P1.9 Error body z Google API** propagowany przez `Result<_, String>` do IPC (`oauth_connect` / `ensure_valid_token`) — redaktuj zanim trafi do frontendu.

### P2 (nice-to-have)
- **P2.9 `app.emit("calendar:events-updated")`** rozsyła pełne dane eventów (title, organizer, meet link) do wszystkich nasłuchujących okien włącznie z popupami — rozważ filtrowanie per-window.
- **P2.10 OAuth callback: `error` sprawdzany przed `state`** — lokalny spoof może przerwać flow bez CSRF check. Odwróć kolejność: najpierw `state`, potem `error`.

## Znaleziska Gemini — Blog Studio (preistniejące, osobna sesja security)

### P1 security (Blog Studio)
- **Path traversal w findArticleFile** (`landing/studio/server.js:~1062`) — łączy `lang` i `slug` z path bez normalizacji. `path.normalize()` + sprawdzenie prefix `BLOG_DIR`.
- **execSync blokujący event loop** (`server.js:~342`, `~621`, `~4271`, `~4474`, `~4856`, `~4978`, `~5321`) — wszystkie wywołania `node build.js` zamrażają Express na czas buildu (30-60s). Użyj asynchronicznego `exec` z `util.promisify`.
- **API keys w studio.json** (`server.js:~2380`) — klucze API Gemini/Claude/Serper w pliku na dysku zamiast w env. studio.json jest gitignored ale to nadal przechowywanie sekretów w plaintext. Przenieś do `.env`.

### P2 (Blog Studio)
- `fs.readFileSync` w gorących ścieżkach Express — async/await
- `analyzeSEO` łamie SRP (kilka regex'ów w jednej funkcji)
- Duże stringi promptów AI bezpośrednio w server.js — wydziel do `prompts/*.txt`

## P5 — Przyszłość
23. macOS tracker (NSWorkspace + Accessibility API)
24. Microsoft Store
25. **HealthDesk Lite — Chrome Extension** (~80% funkcji, Chrome Web Store = 140M+ userów)
26. Achievements / odznaki
27. Keyboard shortcuts — konfiguracja
28. Cloud sync
29. Roczne podsumowanie (Spotify Wrapped)
30. Posture reminder (MediaPipe)
31. Slack status — auto "Na przerwie"
32. HealthDesk Pro (freemium)
