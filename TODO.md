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
2. **Weryfikacja Google OAuth** — złożyć wniosek (review 1-2 tyg)
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
