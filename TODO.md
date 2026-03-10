# TODO

## v2.0.27
- ✅ Fix: YouTube Radio retry (youtube.rs)
- ✅ GA4 Consent Mode v2 + cookie table + link "Cookies" w footerze
- ✅ Onboarding wizard (5-krokowy) + gentle break mode

## Do zrobienia

### P0 — Blokery / infrastruktura
1. Certum Code Signing (~25€/rok) — eliminuje SmartScreen, odblokowuje Reddit/marketing
2. Założyć alias privacy@healthdesk.site w panelu hostingu (cyber-folks) → przekierowanie na główny email

### P1 — Duże feature'y
3. Google Calendar OAuth — "Połącz z Google Calendar" w Settings, readonly scope, refresh token w config, auto-pauza przed spotkaniami, timeline na Home
   - PREP: Złożyć weryfikację aplikacji od razu (review 1-2 tyg)
4. YouTube playlisty — import playlist usera (publiczne + unlisted), lista tracków, auto-next. Opcja cookies dla prywatnych.
5. ~~Onboarding wizard~~ ✅ (v2.0.27)

### P2 — UX / quick wins
6. Tooltip godzin pracy — wyjaśnienie w UI jak działa ustawienie
7. Cotygodniowy summary — toast w poniedziałek z podsumowaniem
8. Ctrl+Shift+W — globalny skrót na wodę
9. Night mode / wind-down

### P3 — Marketing / growth
10. Reddit post (wymaga code signing)
11. Product Hunt launch
12. Strona porównawcza (vs Stretchly, EyeLeo, Workrave)
13. AlternativeTo, Softpedia — katalogi + backlinki
14. Blog SEO — artykuły
15. Pitch do HR — one-pager "HealthDesk dla firm"

### P4 — Backend / analytics
16. Web dashboard dla telemetrii (backend FastAPI ✅ istnieje, brak UI — Chart.js)
17. Blog Studio — zakładka Analytics (GA4 Data API + Chart.js)
18. Crash reporting — rozbudowa o tracebacki (event type `error` ✅ istnieje)

### P5 — Przyszłość
19. macOS tracker (NSWorkspace + Accessibility API)
20. Microsoft Store
21. Achievements / odznaki
22. Keyboard shortcuts — konfiguracja
23. Cloud sync
24. Roczne podsumowanie (Spotify Wrapped)
25. Posture reminder (MediaPipe)
26. Slack status — auto "Na przerwie"
27. HealthDesk Pro (freemium)

## Zrobione
- ~~Trening oddechowy~~ ✅ (v2.0.21)
- ~~Analytics na LP~~ ✅ GA4 + Consent Mode v2 (2026-03-01)
- ~~Telemetria backend~~ ✅ FastAPI endpoints działają
- ~~Licznik pobrań na LP~~ ✅ GitHub Releases API
- ~~Natywne powiadomienia~~ ✅ plugin zainstalowany
