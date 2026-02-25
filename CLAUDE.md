# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**HealthDesk** (zegar-cwieczenia) — Windows desktop wellness app that schedules work breaks, tracks window activity, reminds about water intake, and provides guided eye/stretch exercises. UI is entirely in Polish.

## Commands

```bash
# Run in development
python main.py          # with console
pythonw main.pyw        # without console window

# Install dependencies
pip install -r requirements.txt

# Build Windows executable (includes ffmpeg download, icon generation)
python build.py
# Output: dist/HealthDesk/HealthDesk.exe

# Create installer (requires Inno Setup 6+)
iscc installer.iss
# Output: Output/HealthDesk_Setup.exe
```

No test suite exists.

## Architecture

**Threading model** — 4 threads cooperate via callbacks:
- **Main thread**: tkinter event loop (customtkinter GUI)
- **Tracker thread** (daemon, 5s interval): polls foreground window via Win32 API, categorizes apps, logs to SQLite
- **Scheduler thread** (daemon, 1s interval): manages break/water/exercise timers, fires callbacks when due
- **Tray thread** (daemon): pystray event loop with its own blocking run

**Entry point**: `main.py` creates a hidden root tk window, initializes all subsystems, wires scheduler callbacks to UI window constructors, then starts the tk mainloop.

**Data flow**: Tracker → Database ← UI queries; Scheduler → callbacks → UI windows → Database (log breaks/water).

**Key callback pattern**: Scheduler calls `on_small_break()`, `on_big_break()`, etc. on main.py, which uses `root.after(0, ...)` to marshal UI creation onto the main thread.

## Module Relationships

| Module | Role |
|--------|------|
| `config.py` | JSON config at `%APPDATA%/HealthDesk/config.json` + Windows registry autostart |
| `database.py` | SQLite with thread-local connections, 4 tables: breaks, water, window_activity, sessions |
| `tracker.py` | Win32 ctypes (`GetForegroundWindow`, `QueryFullProcessImageNameW`) → categorizes into 5 categories |
| `scheduler.py` | Timer logic for small/big breaks, water, exercises; respects work hours config |
| `tray.py` | System tray icon + menu; separate thread with pystray |
| `audio_engine.py` | Real-time numpy synthesis (brown noise, rain, forest, etc.) via sounddevice; no audio files |
| `yt_player.py` | YouTube streaming via yt-dlp + ffplay.exe subprocess; 5 preset stations |
| `ads.py` | Remote JSON ad loading from VPS with local cache fallback |
| `ui/main_window.py` | Dashboard with 5-page sidebar: Home, Stats, Audio, Settings, Help |
| `ui/break_window.py` | Moderate break popup (460x390) with optional ad banner |
| `ui/break_fullscreen.py` | Aggressive fullscreen break; triple-click to exit |
| `ui/exercises.py` | Eye exercise and stretch routine windows |
| `ui/water_widget.py` | Bottom-right water reminder widget |

## Platform Constraints

- **Windows-only**: uses ctypes Win32 API, winreg, Windows mutex for single-instance
- **Python 3.10+** with modern type hints (`dict[str, ...]`, `str | None`)
- Audio features are optional — app runs if sounddevice/numpy unavailable
- YouTube Radio requires ffplay.exe (bundled by build.py or found in PATH)

## Conventions

- UI strings use `i18n.t("key")` — locale files in `locales/*.json`, user overrides in `%APPDATA%/HealthDesk/locales/`
- Silent `try/except` blocks throughout for production robustness — features degrade gracefully
- Dark theme with green accent (`#2ecc71`) via customtkinter
- Config uses defaults-merge pattern: `DEFAULTS.copy()` updated with user JSON
- User data stored in `%APPDATA%/HealthDesk/` (config.json, healthdesk.db, ads_cache.json)
- All CTkToplevel windows set `iconbitmap` via `generate_icon()` with `after(200, ...)` delay

## Landing Page Sync

When implementing **user-facing functional changes** (new features, changed behavior, new settings, removed features), always propose updating the landing page (`landing/index.html`, `landing/style.css`) to reflect the changes. This includes:
- New feature sections or updated feature descriptions
- Screenshot updates if UI changed significantly
- FAQ updates if behavior changed
- Removal of references to removed features

**Workflow**: After completing the functional change, propose specific LP updates to the user for approval before implementing. Do not silently update the LP.
