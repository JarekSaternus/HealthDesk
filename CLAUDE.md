# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Język komunikacji

Zawsze komunikuj się z użytkownikiem po polsku.

## Project Overview

**HealthDesk** — cross-platform desktop wellness app (Tauri v2 + React + TypeScript). Schedules work breaks, tracks window activity, reminds about water intake, provides guided eye/stretch exercises. UI in Polish and English.

Rewrite of the original Python/customtkinter version (`zegar-cwieczenia`).

## Commands

```bash
# Development (hot-reload frontend + Rust backend)
npm run tauri dev

# Production build
npm run tauri build
# Output: src-tauri/target/release/bundle/nsis/HealthDesk_<version>_x64-setup.exe

# Frontend only
npm run dev          # Vite dev server
npm run build        # Vite production build
npx tsc --noEmit     # TypeScript check

# Rust only (needs PATH with rustup toolchain)
cd src-tauri && cargo check
cd src-tauri && cargo build --release
```

**Rust PATH setup** (bash on Windows):
```bash
export PATH="/c/Users/jarek/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH"
```

No test suite exists yet.

## Architecture

**Stack:** Tauri v2 (Rust backend) + React 19 + TypeScript + Tailwind CSS 4

**Rust backend** (~2500 lines) — 12 modules in `src-tauri/src/`:
| Module | Role |
|--------|------|
| `config.rs` | JSON config at `%APPDATA%/HealthDesk/config.json`, work method presets |
| `database.rs` | SQLite via rusqlite, 4 tables: breaks, water, window_activity, sessions |
| `scheduler.rs` | Async timer (tauri::async_runtime), emits Tauri events every 1s |
| `tracker.rs` | Win32 API via windows-rs crate, 5s polling, app categorization |
| `popup_manager.rs` | Priority queue for break/exercise/water popups, preemption logic |
| `audio/` | rodio-based: brown noise, rain, white/pink noise, drone, forest + chime |
| `youtube.rs` | yt-dlp + ffplay subprocess for YouTube Radio |
| `ads.rs` | Remote ad loading with cache fallback, HTML sanitization |
| `telemetry.rs` | Async batch telemetry via mpsc channel |
| `tray.rs` | System tray icon + menu via Tauri built-in |
| `i18n.rs` | JSON locale loading with user overlay + deep merge |
| `commands.rs` | ~30 Tauri IPC commands |

**React frontend** (~3100 lines) in `src/`:
| Path | Role |
|------|------|
| `pages/` | Home, Stats, Music, Settings, Help |
| `windows/` | BreakWindow, BreakFullscreen, EyeExercise, StretchExercise, WaterReminder |
| `components/` | Sidebar, BottomBar, Card |
| `stores/appStore.ts` | Zustand store: config, schedulerState, water, page |
| `i18n.ts` | Client-side translation with dot-notation resolve |

**Event flow:** Scheduler emits Tauri events → lib.rs listeners → PopupManager creates windows → React popup components → invoke() IPC back to Rust

**Popup window routing** (separate Tauri webview windows):
- `/break?type=big|small&duration=X` → BreakWindow
- `/break-fullscreen` → BreakFullscreen (aggressive mode)
- `/eye-exercise` → EyeExercise
- `/stretch-exercise` → StretchExercise
- `/water-reminder` → WaterReminder

**Tauri plugins:** autostart, notification, shell (yt-dlp), single-instance, updater

**Data compatibility:** Reads same `%APPDATA%/HealthDesk/` as the Python version (same SQLite schema, same config.json keys).

## Conventions

- UI strings use `t("key")` in React, loaded once from Rust via `get_translations` command
- Locale files in `locales/*.json`, user overrides in `%APPDATA%/HealthDesk/locales/`
- Dark theme: sidebar `#141821`, content `#1a1f2b`, card `#222836`, accent `#2ecc71`
- Tailwind CSS 4 with custom theme colors defined in `src/index.css`
- Popup windows are separate Tauri webview windows routed by URL path
- Async operations use `tauri::async_runtime::spawn` (not raw `tokio::spawn`)
- Config uses defaults-merge pattern via serde defaults

## Wersjonowanie

**WAŻNE:** Przy każdym buildzie (`npm run tauri build`) podbij wersję patch (np. 2.0.0 → 2.0.1 → 2.0.2). Wersja musi być zmieniona w **trzech** plikach jednocześnie:
1. `package.json` — pole `"version"`
2. `src-tauri/Cargo.toml` — pole `version`
3. `src-tauri/tauri.conf.json` — pole `"version"`

## CI/CD

GitHub Actions workflow (`.github/workflows/release.yml`) triggers on tag push `v*`:
- Builds for Windows (MSVC x64), macOS (arm64 + x64), Linux (x64)
- Uploads `.exe`, `.dmg`, `.deb`, `.AppImage` to GitHub Releases
- To release: tag commit with `v<version>` and push

## Landing Page

Static site in `landing/` deployed to `healthdesk.site` via FTP.
- Polish text, dark theme matching the app
- Deploy: upload `landing/*` to FTP `public_html/`

## Build Requirements

- **Node.js 18+**, **npm**
- **Rust 1.77+** with `stable-x86_64-pc-windows-msvc` toolchain
- **Visual Studio Build Tools 2022** (MSVC linker + Windows SDK)
- **yt-dlp + ffplay** (optional — YouTube Radio feature)
