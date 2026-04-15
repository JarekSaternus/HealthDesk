# GEMINI.md

Reguły code review dla agenta **Gemini** używanego w pre-commit hooku HealthDesk. Projekt jest mieszany (Rust + TypeScript/React + Python + Node), więc zastosuj regułę odpowiednią do rozszerzenia pliku.

## Format uwag

```
[PLIK:LINIA] [POZIOM] opis
```

Poziomy:
- `KRYTYCZNY` — blokuje commit (security, bug, data loss, niezdefiniowane zachowanie)
- `WAŻNY` — warto poprawić, ale nie blokuje
- `NIT` — kosmetyka, styl

**Maksymalnie 10 uwag** na jeden review. Priorytetyzuj KRYTYCZNE.

## Nazewnictwo

- **Rust:** `snake_case` (funkcje, zmienne, moduły), `PascalCase` (struct, enum, trait), `SCREAMING_SNAKE_CASE` (const, static)
- **TypeScript/React:** `camelCase` (zmienne, funkcje), `PascalCase` (typy, komponenty, interfejsy), `SCREAMING_SNAKE_CASE` (moduło-stałe)
- **Python:** `snake_case` (funkcje, zmienne, moduły), `PascalCase` (klasy), `SCREAMING_SNAKE_CASE` (stałe)
- **Nazwy muszą mówić co**, nie jak. `user_email` > `ue`, `schedule_break_in_seconds` > `sbs`.
- Komponenty React w katalogach `pages/`, `windows/`, `components/` — jeden komponent = jeden plik, nazwa pliku = nazwa komponentu.

## SOLID z przykładami dla tego projektu

- **Single Responsibility** — `scheduler.rs` powinien liczyć czas i emitować eventy, nie zarządzać oknami popupów. Jeśli widzisz, że moduł robi dwie rzeczy, flaguj.
- **Open/Closed** — work methods w `config.rs` to preset pattern — nowa metoda powinna dodawać preset, nie edytować logiki schedulera.
- **Liskov** — w React preferuj composition nad "special case" proporcjami komponentów.
- **Interface Segregation** — Tauri IPC commands w `commands.rs` powinny mieć wąski kontrakt; nie zwracaj "god objectu" z 15 polami gdy front potrzebuje 2.
- **Dependency Inversion** — w Rust używaj traits dla testowalności (np. `trait AudioPlayer` dla `audio/`), w TS — props/hooks zamiast sztywnych importów state managera w głąb drzewa.

## DRY z umiarem

- **3 kopie = wydziel** do wspólnej funkcji/komponentu/modułu.
- **2 kopie = zostaw.** Nie twórz abstrakcji dla dwóch przypadków — częściej kończy się to dziwnym API niż oszczędnością.
- **Nie twórz "helper God-module"** typu `utils.ts` — grupuj po domenie (`time.ts`, `format.ts`).
- Popupy (`BreakWindow`, `EyeExercise`, `StretchExercise`, ...) mogą dzielić wspólny layout (`PopupShell`), ale zachowuj różnice — nie wymuszaj jednego komponentu z 20 propsami.

## Null / undefined / None safety

- **Rust:** preferuj `Option<T>` nad sentinel values. `.unwrap()` tylko w testach lub dokładnie uargumentowanych miejscach. Flaguj `.unwrap()` w src bez komentarza.
- **TypeScript:** `strict: true` jest włączone — szanuj to. Flaguj `!` (non-null assertion) bez komentarza wyjaśniającego dlaczego jest bezpieczne.
- **Python:** używaj `Optional[T]` / `T | None` + mypy-friendly guardy. `if x is not None` zamiast `if x`.
- **Rust `Result<T, E>`** propaguj przez `?`, nie rób `match` tylko po to, żeby zrobić `panic!` w `Err`.

## Async

- **Rust (Tauri):** `tauri::async_runtime::spawn` NIE `tokio::spawn`. Flaguj `tokio::spawn` w src-tauri jako KRYTYCZNY (task może nie dołączyć do runtime).
- **Rust (Tauri commands):** `#[tauri::command] async fn` — zawsze `Result<T, String>` jako zwrot (frontend łapie jako `Promise.reject`).
- **TypeScript:** `async/await`, nie `.then()` łańcuchy. Zawsze `try/catch` wokół `invoke()`.
- **Python (FastAPI):** endpointy `async def` — NIE używaj synchronicznego I/O (`open()`, `requests`, `time.sleep`). Użyj `aiofiles`, `httpx.AsyncClient`, `asyncio.sleep`. Flaguj jako KRYTYCZNY, bo blokuje event loop.
- **Node (landing/studio):** `async/await` + `await` przed każdym Promise. `new Promise((res, rej) => ...)` tylko gdy wrapping callback API.

## Kolekcje / iteratory / comprehensions

- **Rust:** preferuj iterator chains (`iter().filter().map().collect()`) nad pętle `for`. Unikaj `clone()` gdy można `&`/`into_iter()`.
- **TypeScript:** `.map`/`.filter`/`.reduce` dla transformacji, `for ... of` dla side-effectów. Nie mutuj wejściowej tablicy.
- **Python:** list/dict comprehensions dla prostych transformacji, zwykła pętla dla logiki > 1 linii.

## Flagi KRYTYCZNE (auto-block commit)

Gemini ma **obowiązkowo** oflagować jako KRYTYCZNY:

1. **Hardkodowany sekret** — regex `GOCSPX-`, `sk-[A-Za-z0-9]{20,}`, `AIza[A-Za-z0-9]{35}`, `Bearer `, `BEGIN PRIVATE KEY`, stringi podobne do hasła przy polach `password|pass|pwd|secret|token|key`.
2. **SQL przez konkatenację** w `rusqlite` / `sqlalchemy` / `sqlite3` — zawsze `?` placeholders.
3. **Path traversal** — `std::path::Path::new(user_input)` bez walidacji / `os.path.join(base, user_input)` bez normalizacji.
4. **`eval`/`exec` w Python**, `Function()` / `eval()` w JS — zawsze KRYTYCZNY.
5. **`tokio::spawn` w src-tauri** zamiast `tauri::async_runtime::spawn`.
6. **Sync I/O w async FastAPI endpoint** (blokuje event loop).
7. **`.unwrap()` / `.expect()` na wartości pochodzącej od użytkownika / z sieci / z pliku** w Rust release path.
8. **`any`** w TS dla danych z IPC / API bez komentarza "dlaczego".
9. **Logowanie PII** — email, ścieżka `C:\Users\<name>`, treść notatek/okien, payload IPC zawierający user data.
10. **Brak `.gitignore`** dla nowego pliku wyglądającego na sekret/lock/runtime state.

## Testy

W HealthDesk nie ma obecnie test suite — więc NIE flaguj braku testów jako KRYTYCZNY. Jeśli widzisz **nowe testy**:

- **Rust:** `#[cfg(test)]` w tym samym pliku lub `src-tauri/tests/`. Nazwa: `test_what_when_then`.
- **TS/Vitest:** `describe('Module', () => it('should ... when ...', ...))`.
- **Python/pytest:** `def test_what_when_then():`, fixtures w `conftest.py`.

Wymagaj: asercje > 0, brak testów zależnych od sieci/DB/fs bez mock/fixture, brak `time.sleep` / `setTimeout` jako sync.

## Kiedy NIE flagować

- Style komentarzy (single-line vs block) jeśli projekt już mieszany.
- Nazwy zmiennych w istniejącym kodzie — flaguj tylko w staged diffach.
- Formatowanie — to robi `rustfmt`/`prettier`, nie review.
- "Mógłbyś użyć pattern X zamiast Y" jeśli Y działa, jest bezpieczny i pasuje do reszty codebase.
- Brak docstringów — projekt ich nie wymaga.

## Przykład dobrego review

```
[src-tauri/src/calendar.rs:10] [KRYTYCZNY] Hardkodowany CLIENT_SECRET GOCSPX-... — przenieś do option_env!("GOOGLE_CLIENT_SECRET") lub PKCE flow.
[src/pages/Stats.tsx:47] [WAŻNY] Użycie `any` w odpowiedzi z invoke('get_stats') — zadeklaruj typ StatsResponse.
[server/app/routers/telemetry.py:89] [KRYTYCZNY] Sync open() w async endpoint — użyj aiofiles.open().
[landing/studio/server.js:234] [WAŻNY] Brak try/catch wokół fs.promises.writeFile — błąd zapisu wywali process.
```
