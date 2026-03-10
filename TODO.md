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
3. Google Calendar OAuth ✅ (v2.0.28-dev) — OAuth loopback flow, sync co 5 min, bloki spotkań na timeline
   - ⬜ Smart scheduling — auto-pauza podczas spotkań, przesuwanie przerw na wolne sloty
   - ⬜ Pre-meeting reminder ("Za 5 min spotkanie — czas na przerwę i wodę")
   - ⬜ Złożyć weryfikację aplikacji Google (review 1-2 tyg)
4. Harmonogram tygodniowy ✅ (v2.0.28-dev) — per-day profil przerw + DayTimeline na Home
   - ⬜ GUI polish — dopracowanie UI harmonogramu i timeline
   - ⬜ Suwak drag do ad-hoc przesuwania przerw (jednorazowe override)
5. **Przebudowa Settings / Dashboard** — Settings robi się za duży, potrzebna reorganizacja:
   - Podzielenie Settings na zakładki/sekcje (np. Przerwy, Wellness, Integracje, System)
   - Lub nawigacja boczna w Settings
   - Dashboard Home — uporządkowanie kart przy rosnącej liczbie widgetów
6. YouTube playlisty — import playlist usera (publiczne + unlisted), lista tracków, auto-next. Opcja cookies dla prywatnych.
7. ~~Onboarding wizard~~ ✅ (v2.0.27)

### P2 — UX / quick wins
7. Tooltip godzin pracy — wyjaśnienie w UI jak działa ustawienie
8. Cotygodniowy summary — toast w poniedziałek z podsumowaniem
9. Ctrl+Shift+W — globalny skrót na wodę
10. Night mode / wind-down

### P3 — Marketing / growth
11. Reddit post (wymaga code signing)
12. Product Hunt launch
13. Strona porównawcza (vs Stretchly, EyeLeo, Workrave)
14. AlternativeTo, Softpedia — katalogi + backlinki
15. Blog SEO — artykuły
16. Pitch do HR — one-pager "HealthDesk dla firm"

### P4 — Backend / analytics
17. Web dashboard dla telemetrii (backend FastAPI ✅ istnieje, brak UI — Chart.js)
18. Blog Studio — zakładka Analytics (GA4 Data API + Chart.js)
19. Crash reporting — rozbudowa o tracebacki (event type `error` ✅ istnieje)

### P5 — Przyszłość
20. macOS tracker (NSWorkspace + Accessibility API)
21. Microsoft Store
22. Achievements / odznaki
23. Keyboard shortcuts — konfiguracja
24. Cloud sync
25. Roczne podsumowanie (Spotify Wrapped)
26. Posture reminder (MediaPipe)
27. Slack status — auto "Na przerwie"
28. HealthDesk Pro (freemium)

## Zrobione
- ~~Trening oddechowy~~ ✅ (v2.0.21)
- ~~Analytics na LP~~ ✅ GA4 + Consent Mode v2 (2026-03-01)
- ~~Telemetria backend~~ ✅ FastAPI endpoints działają
- ~~Licznik pobrań na LP~~ ✅ GitHub Releases API
- ~~Natywne powiadomienia~~ ✅ plugin zainstalowany
