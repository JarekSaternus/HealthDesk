# AGENTS.md

Twarde reguły dla agentów AI (Claude Code, Gemini, Codex, Cursor, Copilot) pracujących w repozytorium **HealthDesk**. Łam je tylko jeśli user wyraźnie prosi — i wtedy zapisz wyjątek w commit message.

## Czego NIE robić

### Rust / Tauri backend (`src-tauri/`)

- **Nie hardkoduj sekretów** (client_secret, API key, hasło, token). Używaj `option_env!("NAZWA")` na build-time lub `std::env::var` na runtime. Patrz incydent w `calendar.rs` — rotacja OAuth client była wymuszona.
- **Nie używaj `.unwrap()` / `.expect()` w ścieżce produkcyjnej** — obsłuż błąd przez `Result` i propaguj do frontu przez `tauri::command -> Result<T, String>`.
- **Nie wołaj `tokio::spawn`** — używaj `tauri::async_runtime::spawn`, inaczej task nie dołączy do runtime Tauri.
- **Nie blokuj wątku UI** — długie operacje (DB, HTTP, audio decode) zawsze w `async_runtime::spawn_blocking` lub async task.
- **Nie dodawaj nowych IPC command bez sprawdzenia `capabilities/default.json`** — Tauri v2 ACL odrzuci wywołanie na popup windows.
- **Nie używaj `println!`/`eprintln!` do logowania** — używaj `log::info!`/`log::error!` (inicjalizacja w `lib.rs`).
- **Nie commituj zmian w `src-tauri/target/`** (jest w `.gitignore`, ale sprawdzaj).

### React / TypeScript frontend (`src/`)

- **Nie wyłączaj `strict` w `tsconfig.json`** ani nie dodawaj `// @ts-ignore` bez komentarza wyjaśniającego.
- **Nie używaj `any`** bez uzasadnienia — preferuj `unknown` + type guard.
- **Nie wywołuj `invoke()` bez obsługi błędu** — Tauri rzuca na ACL reject, timeout, panic w Rust.
- **Nie subskrybuj Tauri event listenerów w popup windows** (BreakWindow, EyeExercise, etc.) — ACL na to nie pozwala, usuwaj `listen()` calle z komponentów popupów.
- **Nie trzymaj stanu w `useState` gdy należy do store** — używaj `stores/appStore.ts` (Zustand).
- **Nie hardkoduj stringów UI** — wszystkie user-facing teksty przez `t("klucz")`, klucze w `locales/*.json`.

### Landing + Blog Studio (`landing/`)

- **Nie commituj `landing/studio/studio.json`** (ma API keys: Claude, Gemini, Serper, OpenAI, GSC token). Jest w `.gitignore`.
- **Nie commituj `landing/gsc-key.json`** (Google Service Account).
- **Nie hardkoduj hasła FTP** — używaj `process.env.FTP_PASS` z hard-fail jeśli brak. Żadnych fallbacków.
- **Nie committuj `landing/dist/`** ani wygenerowanych plików blog (`landing/studio/server-*.log`, `scheduler_log.json` do runtime state).

### Python / FastAPI backend (`server/`)

- **Nie commituj `.env`** ani żadnego pliku z rzeczywistymi wartościami `API_SECRET_KEY`, `ADMIN_PASSWORD_HASH`, `DATABASE_URL`.
- **Nie używaj `except Exception: pass`** — loguj i re-raise albo zwracaj HTTPException.
- **Nie używaj `eval`/`exec`** — nie ma powodu, żeby pojawiły się w telemetry/ads/admin.
- **Nie używaj synchronicznego I/O (`open()`, `requests`) w async endpointach** — używaj `aiofiles`, `httpx.AsyncClient`.
- **Nie zwracaj szczegółów stack trace w response** — zostaw to loggerowi.

### Globalnie

- **Nigdy `git add -A` ani `git add .`** — dodawaj pliki po nazwie. Inaczej łapiesz `credentials.json`, `.claude/`, logi, PNG untracked.
- **Nigdy `--no-verify`** przy commicie — jedyny wyjątek to pierwotna instalacja pre-commit hooka (commit 5 w historii).
- **Nigdy `git push --force`** na `master` / `origin/master`. Tag `v*` pushuje się przez `git push origin v<wersja>`.
- **Nigdy `rm -rf`** na folderach w repo bez `git status` przed.
- **Nigdy nie edytuj `package-lock.json`/`Cargo.lock` ręcznie** — pozwól narzędziom to zrobić.

## Struktura plików

```
healthdesk-tauri/
├── src/                    # React 19 frontend
│   ├── pages/             # Home, Stats, Music, Settings, Help
│   ├── windows/           # BreakWindow, EyeExercise, WaterReminder, ...
│   ├── components/        # Sidebar, BottomBar, Card
│   ├── stores/            # appStore.ts (Zustand)
│   └── i18n.ts            # Client-side t() lookup
├── src-tauri/
│   ├── src/               # Rust backend (12 modułów, ~2900 linii)
│   │   ├── lib.rs         # Entry point + event wiring
│   │   ├── commands.rs    # 32 Tauri IPC commands
│   │   ├── scheduler.rs   # Async timer, emisja eventów
│   │   ├── tracker.rs     # Win32 window activity
│   │   ├── database.rs    # SQLite (rusqlite)
│   │   ├── config.rs      # JSON config w %APPDATA%
│   │   ├── calendar.rs    # Google Calendar OAuth (PKCE TODO)
│   │   ├── popup_manager.rs
│   │   ├── audio/         # rodio ambient sounds
│   │   ├── youtube.rs     # yt-dlp subprocess
│   │   ├── ads.rs, telemetry.rs, tray.rs, i18n.rs
│   ├── capabilities/      # Tauri v2 ACL per window label
│   ├── tauri.conf.json    # version, bundle, windows
│   └── Cargo.toml         # version
├── locales/               # JSON translations (12 języków)
├── landing/               # Static site → healthdesk.site
│   ├── src/content/blog/<lang>/   # Markdown posty
│   ├── studio/            # Express Blog Studio (internal tool)
│   ├── build.js, deploy.js
│   └── scripts/           # SEO repair, image regen
├── server/                # FastAPI (telemetry, ads, admin)
│   └── app/
│       ├── main.py
│       ├── auth.py        # JWT, env vars only
│       ├── database.py    # SQLAlchemy
│       └── routers/       # telemetry, ads, admin, downloads
├── scripts/hooks/         # pre-commit multi-agent
├── .github/workflows/     # release.yml (tag v* → build + release)
├── CLAUDE.md              # Kontekst projektu dla agentów
├── AGENTS.md              # Ten plik — twarde reguły
├── GEMINI.md              # Reguły code review
├── TODO.md                # Otwarte zadania
└── package.json           # version — podbijać razem z Cargo.toml + tauri.conf.json
```

## Checklist security przed commitem

Zaznacz przed `git commit`:

- [ ] Żadnego hardkodowanego sekretu (`git diff --cached | grep -iE 'secret|password|api[_-]?key|token|GOCSPX|sk-'`)
- [ ] Żadnego `.env*`, `credentials.json`, `studio.json`, `gsc-key.json`, `*.pem`, `*.key` w staged
- [ ] `.gitignore` pokrywa wszystkie nowe pliki runtime/build (`dist/`, `target/`, `*.log`, `__pycache__/`)
- [ ] Walidacja inputu na wszystkich IPC commands, które przyjmują string od frontu (path traversal, SQL injection via rusqlite parametry — nie konkatenacja)
- [ ] Logi nie zawierają PII (email, ścieżki z nazwą użytkownika, zawartość okien, treść notatek)
- [ ] `npm run build` zielono (tsc strict + vite)
- [ ] `cd src-tauri && cargo check` zielono
- [ ] Popup windows nie rejestrują event listenerów (patrz ACL w `capabilities/default.json`)
- [ ] Wersja podbita w **trzech plikach** jeśli to release commit (`package.json`, `Cargo.toml`, `tauri.conf.json`)
- [ ] TODO.md zaktualizowane jeśli zamykasz punkt

## Gdy coś nie działa

- **Hook blokuje commit z `KRYTYCZNY` od Gemini** — przeczytaj uwagi, popraw kod, spróbuj znowu. Nie obchodź `--no-verify`.
- **Codex security flag `high severity`** — to samo. Jeśli false positive, dodaj komentarz wyjaśniający w kodzie + zostaw nowy flag w TODO.md.
- **`cargo check` pada na brak toolchainu** — `export PATH="/c/Users/jarek/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH"` (bash Windows).
- **`tsc` pada na "Cannot find module '@tauri-apps/..."`** — `npm install`, `package-lock.json` może być desynced.
- **`gemini`/`codex` CLI nie ma w PATH** — hook to toleruje, puści tylko build+test. Nie jest to powód do `--no-verify`.
- **Tauri ACL error `.not allowed on window 'break-window'`** — usuń `listen()` z popup window albo dodaj uprawnienie w `capabilities/default.json` (ostrożnie — większe capabilities = większy attack surface).
- **Test padł i nie wiesz czemu** — brak test suite w projekcie, więc hook nie uruchamia testów. Jeśli chcesz je dodać — utwórz `src-tauri/tests/` + `vitest.config.ts` i dopisz do hooka.
