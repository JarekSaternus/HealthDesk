# TODO

## Niewydane na masterze (v2.1.0)
- ✅ Autostart fix (#[cfg(not(debug_assertions))])
- ✅ Harmonogram tygodniowy (3 tryby + DayTimeline)
- ✅ Google Calendar OAuth (multi-cal, smart scheduling, pre-meeting reminders)
- ✅ Settings: 4 zakładki (Przerwy, Wellness, Integracje, System)
- ✅ Dashboard: kompaktowy layout
- ✅ Help page: nowe sekcje

## P0 — Blokery
1. ✅ **Certum Code Signing — ZDOBYTY (2026-05-16)** — odblokowuje promo + SEO engine. Następny krok: wpiąć podpis `.exe` do build/CI (signtool + Certum cryptoCertum) i odpalić wstrzymane kampanie.
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

## SEO Engine — Warstwy C–G (po Certum cert, 2026-05-16)

Cel: z "AI quality gate + GSC loop" → pełny **SEO production pipeline + technical QA + internal linking + learning loop**.
Stan: Warstwa A = `doAudit()` AI-fingerprint (`landing/studio/server.js:1466`, pętla `:3823-3868`). Warstwa B = SEO Coach (`server.js:3420+`, `tools/seo-coach.js`, `seo_coach_state.json`).
**Twarda zasada:** NIE mieszać audytu AI-human ze SEO score — osobne moduły, osobne progi. AI-fingerprint docelowo waga ~5-10%.

Docelowy pipeline: `1 keyword → 2 SERP+intent → 3 brief → 4 draft → 5 AI-human audit → 6 humanize/grammar → 7 SEO on-page audit → 8 internal links → 9 meta → 10 image → 11 build → 12 technical HTML audit → 13 deploy → 14 GSC submit/sitemap → 15 GSC monitor → 16 Coach experiments → 17 decay/refresh → 18 learning loop`

### Warstwa C — Pre-publish SEO On-Page Audit  ⬅ START
Moduł `landing/studio/tools/seo-onpage-audit.js` (NIE w server.js). Wejście: markdown + frontmatter (title, slug, description, keyword, tags, lang, faq) + sitemap/URL-index. Wyjście JSON:
`{ score 0-100, status PASS|WARN|FAIL, blocking_issues[], warnings[], opportunities[], auto_fixes[], internal_link_suggestions[], schema_recommendations[], title_recommendations[], meta_recommendations[], cannibalization_risks[] }`
Kategorie score: title / meta / heading / content_intent / internal_link / image / schema / eeat / technical / cannibalization.
Checki markdown: 1×H1 (lub potwierdź że H1 z templatki), struktura H2/H3 bez przeskoków, title len + primary KW + ≠ duplikat H1, meta len/intencja/CTA, intro odpowiada na intent szybko, brak keyword stuffing, ≥3 internal link opportunities, ≥1 link do money page (= landing root per lang, np. `healthdesk.site/en/`), alt obrazów opisowy, sekcja praktycznego doświadczenia, konkluzja nie-filler.
**E-E-A-T uwaga:** frontmatter NIE ma `author` ani `updated/modified` — audit musi to flagować.
Progi: **≥80 PASS · 65-79 WARN** (deploy + zapis rekomendacji) **· <64 FAIL** (block deploy + ticket).
Integracja autopilot: AI-human audit → jeśli pass → SEO on-page audit → <80/FAIL: 1 runda auto-fix → re-audit → dalej FAIL: block + raport; WARN: deploy + zapis; PASS: dalej.
API: `POST /api/seo/audit-onpage`. CLI: `node tools/seo-onpage-audit.js --file post.md --keyword "..."`. Raporty: `reports/seo-audits/YYYY-MM-DD-slug.{md,json}`.
Testy: brak meta → WARN/FAIL; duplikat H1 → FAIL; brak internal links → WARN; dobry post → ≥80.

### Warstwa D — Technical URL Audit po buildzie (przed deploy)
Audyt wyrenderowanego HTML (nie markdown): title obecny i nie-duplikat, meta description, canonical = finalny URL, robots valid, OG/Twitter, JSON-LD valid + `Article/BlogPosting` + `BreadcrumbList`, img width/height, lazy-load poza hero/LCP, brak broken/404 internal links, dokładnie 1×H1 w DOM.
CLI: `node tools/seo-onpage-audit.js --url http://localhost:4000/...`. **Critical → block deploy** (brak title/canonical, błędny noindex, broken page, JSON-LD crash, zły H1 count).
Uwaga: landing statyczny → większość ustawiana raz w templatce; to walidator regresji, nie generator.

### Warstwa E — Internal Linking Engine  (największa dźwignia in-site)
Indeks URL z sitemapy/contentu: `{url,title,h1,topics,money_page,target_keywords,last_updated}`. Dla nowego wpisu: (a) linki out do podobnych, (b) stare posty które mają linkować in, (c) anchory (bez over-optimized exact-match), (d) gwarancja ścieżki do money page. Reuse Serper embeddings/topiki.

### Warstwa F — Content Decay / Refresh Coach
Osobny moduł obok SEO Coach. Reguły GSC: impressions_28d ↓>25% vs prev, avg_position ↓>3, CTR ↓>20%, age>180d → **refresh ticket** (title/FAQ/rok/świeże dane/internal links/schema/intro pod intent).

### Warstwa G — SERP Intent Analyzer (przed pisaniem)
Z już pobieranego Serper top10 klasyfikuj typ SERP (listicle/ranking/category/local/video/FAQ/comparison/definition/"best X"/"how to"). Wymuś zgodność struktury draftu; mismatch intent → FAIL audytu (wpina się w Warstwę C jako content_intent_score).

### Status realizacji (2026-05-16) — ZBUDOWANE
- ✅ **Warstwa C** — `tools/seo-onpage-audit.js` + endpoint `POST /api/seo/audit-onpage` + autopilot non-blocking logger + 1 runda auto-fix (title/meta) + `enforceSeoGate` (FAIL<64 → retry do 2× → potem publish+`seo_review_needed`) + raport json/md + 30 testów (`npm run test:seo`)
- ✅ **Warstwa G** — `tools/serp-intent.js`, wpięty w `content_intent` (mismatch struktury vs SERP intent → penalty)
- ✅ **Warstwa F** — `tools/decay-coach.js` + `runDecayScan` + `POST /api/seo-coach/decay-scan` + weekly hook → tickety `content_decay`
- ✅ **Cannibalization** — `tools/cannibalization.js` + `POST /api/seo-coach/cannibalization-scan` (GSC query+page overlap) + weekly → tickety `cannibalization`
- ✅ **CWV** — `tools/cwv-monitor.js` + `POST /api/seo/cwv-scan` (PSI per template) + weekly → tickety `cwv_regression`. ⚠️ **Wymaga `pagespeed_api_key` w studio.json** (bez klucza PSI = HTTP 429; darmowy klucz Google Cloud)
- ✅ **Backlink tracker** — `tools/backlink-tracker.js` + `backlinks.json` + `/api/backlinks` (GET/POST), `/api/backlinks/check` (liveness), `/api/backlinks/discover` (GA4 referrery) + weekly. ⚠️ **Ograniczenie:** discovery łapie tylko backlinki dające ruch (GA4); pełny indeks wymaga płatnego API (Ahrefs/Majestic) — świadoma decyzja zakresu

### Status II tura (2026-05-16) — ZBUDOWANE
- ✅ **pagespeed_api_key** dodany do studio.json (gitignored), CWV ciągnie realne dane (landing LCP 2167ms / blog-post 2418ms — GOOD, zero 429)
- ✅ **Warstwa D** — `tools/technical-audit.js` + `enforceTechnicalGate` (po build, przed deploy, FAIL→retry≤2) + endpoint `/api/seo/technical-audit`. Fix krytyczny: `mailto:` false-positive
- ✅ **Warstwa E** — `tools/internal-link-engine.js` + `/api/seo/internal-links` (Jaccard, outbound/inbound/money/anchor-diversity) + **fix `build.js` usedIds** (reset per post — czyste anchory)
- ✅ **UI SEO Coach** w Studio (sidebar) — tickety wszystkich typów (accept/snooze/reject + Skanuj wszystko) + zakładka Backlinks (add/check/discover). Self-contained, zero zmian w studio-app.js
- ✅ **Hook diff-only** — Gemini I Codex recenzują tylko staged diff (nie całe pliki). Koniec z wymuszonym `--no-verify` (zwalidowane: 804533b przeszedł czysto z server.js)
- Testy: 42/42 (`npm run test:seo`)

### Status III tura (2026-05-16, review-driven hardening)
- ✅ **#1+#2 Technical critical hard-block** — `critical_issues` (noindex/canonical/title/H1/JSON-LD) → NIGDY publish, KW→tech_blocked (poza rotacją) + ticket `technical_critical`. Non-critical → retry≤2→publish+flaga
- ✅ **#3 Internal-link auto przy publikacji** — runAutopilot → raport + advisory ticket `internal_links` (bez auto-injekcji)
- ✅ **#5 Indexing verification** — published 7-30d → GSC URL Inspection → `not_indexed` ticket (na żywo: 10 wykrytych). Endpoint `/api/seo/indexing-check` + weekly
- ✅ **Coach autopilot money-page** — opt-in flag (default OFF), auto-apply recommended + `runAutopilotRollbackCheck` (≥21d, LOSER→cofnij do oryginału). UI checkbox. Tylko money-page (mierzalne+odwracalne); reszta advisory
- Testy: 44/44. Wszystkie commity bez --no-verify (hook diff-only działa)

### Pozostało (drobne, opcjonalne)
- Warstwa C: `auto_fixes` na razie = rekomendacje (auto-apply tylko title/meta); rozszerzyć o internal-links auto-inject (ostrożnie)
- `saveCoachState`/`saveBacklinks` bez try/catch (preexisting wzorzec — Gemini WAŻNY)
- Powiadomienia tylko popup Windows (Telegram/digest — odrzucone teraz, kiedyś agent-herald)

### Odblokowane przez cert (z pamięci, do uruchomienia)
- Podpis `.exe` w build/CI (signtool + cryptoCertum) — warunek wszystkiego poniżej
- Money pages title rewrite re-check (≥50 imp); diagnoza `pomodoro-vs-52-17` (0 imp od 04-10 — zaindeksowany?)
- Social UTM helper w Studio (~1-2h), Backlink tracker w Studio (~3-4h)
- HN / Reddit / Product Hunt / AlternativeTo / Softpedia promo

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
- **🐛 `usedIds` nie resetowane między postami** (`landing/build.js:~25`) — mapa unikalnych ID nagłówków w zasięgu modułu, nie czyszczona per-plik. Kolejne artykuły dostają błędne sufiksy ID (`-1`, `-2`) → **psuje anchory/linkowanie wewnętrzne** (TOC, deep-linki, fragment URLs). Bug funkcjonalny (nie security), preexisting. Reset `usedIds` na początku renderowania każdego posta. **Istotne dla Warstwy E (Internal Linking Engine)** — patrz sekcja "SEO Engine".

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
