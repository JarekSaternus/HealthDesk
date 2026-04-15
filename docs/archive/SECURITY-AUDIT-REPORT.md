# Security Audit Report

**Projekt:** HealthDesk
**Data:** 2026-03-17 (re-audit po naprawach)
**Stack:** Tauri v2 (Rust) + React 19 + FastAPI backend
**Audytor:** Claude Code Security Audit Skill

## Podsumowanie

| Poziom | Liczba | Status |
|--------|--------|--------|
| KRYTYCZNE | 0 | Wszystkie naprawione |
| WYSOKIE | 0 | Wszystkie naprawione |
| SREDNIE | 1 | Informacyjne |
| NISKIE | 1 | Informacyjne |

---

## Naprawione problemy

### KRYTYCZNE (naprawione)

#### 1. Haslo FTP w CLAUDE.md
- **Status:** NAPRAWIONE
- Haslo FTP zmienione w panelu cyber-folks.pl
- CLAUDE.md uzywa teraz `$FTP_USER:$FTP_PASS` zamiast plaintext
- Stare haslo w historii git jest nieaktualne (zrotowane)

#### 2. Google OAuth client_secret
- **Status:** AKCEPTOWALNE
- Google traktuje client_secret jako publiczny dla "installed app" (desktop)
- credentials.json nigdy nie commitowany (.gitignore)

### WYSOKIE (naprawione)

#### 3. JWT secret fallback
- **Status:** NAPRAWIONE
- Usuniety fallback "dev-secret-change-me"
- Bez env var generowany jest losowy `secrets.token_urlsafe(32)`
- Na VPS ustawiony silny klucz w `.env`

#### 4. SHA256 → bcrypt
- **Status:** NAPRAWIONE
- `passlib.CryptContext(schemes=["bcrypt"])` zamiast SHA256 z hardkodowanym saltem
- Hash admina na VPS zaktualizowany do formatu bcrypt

#### 5. Domyslne haslo admina "admin"
- **Status:** NAPRAWIONE
- Usuniety fallback — `ADMIN_PASSWORD_HASH` musi byc ustawiony w env
- Bez env var logowanie jest zablokowane (dodatkowe zabezpieczenie w admin.py)

#### 6. CORS allow_origins=["*"]
- **Status:** NAPRAWIONE
- Ograniczone do `healthdesk.site` + `api.healthdesk.site`
- Konfigurowalne przez env `CORS_ORIGINS`

### SREDNIE (naprawione)

#### 7. Rate limiting
- **Status:** NAPRAWIONE
- `slowapi` zainstalowany i skonfigurowany
- Login: max 5 prob/min
- Limiter globalny gotowy do rozszerzenia

---

## Pozostale (niskie ryzyko)

#### 8. innerHTML w landing page
- **Lokalizacja:** `landing/index.html`, `landing/src/templates/demo.html`
- **Ryzyko:** Niskie — dane z kontrolowanych obiektow JS (tlumaczenia), nie user input
- **Akcja:** Opcjonalnie zamienic na `textContent` gdzie nie potrzeba HTML

#### 9. Service file z placeholderami
- **Lokalizacja:** `server/deploy/healthdesk-api.service`
- **Ryzyko:** Niskie — plik wzorcowy, VPS uzywa EnvironmentFile z .env
- **Akcja:** Brak — produkcja uzywa poprawnych wartosci z `/home/claude/healthdesk-api/.env`

---

## Pozytywne ustalenia

- **npm audit:** 0 luk w zaleznosciach frontendowych
- **credentials.json:** Nigdy nie commitowany do git (.gitignore)
- **studio.json:** Nigdy nie commitowany (API keys bezpieczne)
- **gsc-key.json:** W .gitignore, nigdy nie commitowany
- **Tauri capabilities:** Minimalne uprawnienia, poprawna konfiguracja ACL
- **Ads module:** Sanityzacja URL-i (sanitize_url, sanitize_ad)
- **Studio API keys:** Ladowane z env/studio.json (nie hardkodowane)
- **Brak SQL injection:** ORM/parametryzowane zapytania
- **Brak plikow wrazliwych w katalogach publicznych**
- **Brak hardkodowanych sekretow w kodzie**

---

## Deployment Checklist

- [x] Haslo FTP zmienione i usuniete z CLAUDE.md
- [x] .env jest w .gitignore
- [x] credentials.json w .gitignore i nie commitowany
- [x] npm audit bez luk
- [x] Silny API_SECRET_KEY na produkcji
- [x] Silny ADMIN_PASSWORD_HASH (bcrypt) na produkcji
- [x] Bcrypt zamiast SHA256 do hashowania hasel
- [x] CORS ograniczony do wlasnych domen
- [x] Rate limiting na logowaniu (5/min)
- [ ] Security headers na serwerze (nginx)
- [x] HTTPS — API na api.healthdesk.site
- [x] Tauri ACL — minimalne uprawnienia per okno

## Zalecenia

1. Dodac security headers w nginx (X-Content-Type-Options, X-Frame-Options, CSP)
2. Rozwazyc WAF (Cloudflare Free)
3. Zaplanowac cykliczne audyty (co kwartal)
