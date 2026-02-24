"""YouTube audio streaming for work music (instrumental, no vocals).

Uses yt-dlp to extract audio URL and ffplay to play it.
ffplay is bundled with the installer or must be on PATH.
"""
import atexit
import subprocess
import threading
import shutil
import sys
import os

_lock = threading.Lock()
_process: subprocess.Popen | None = None
_current_station: str | None = None
_current_audio_url: str | None = None  # cached audio URL for volume restart
_volume: int = 50  # 0-100 for ffplay
_generation: int = 0  # incremented on each play/stop to cancel stale threads


def _find_ffplay() -> str | None:
    """Find ffplay.exe - bundled next to exe or on PATH."""
    if getattr(sys, 'frozen', False):
        bundled = os.path.join(os.path.dirname(sys.executable), "ffplay.exe")
        if os.path.exists(bundled):
            return bundled
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ffplay.exe")
    if os.path.exists(local):
        return local
    return shutil.which("ffplay")


# Preset stations: instrumental music for work, no vocals
STATIONS = {
    "lofi_girl": {
        "name": "Lofi Girl",
        "desc": "Lofi hip hop - beats to relax/study to",
        "icon": "\U0001f3a7",
        "url": "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    },
    "jazz_cafe": {
        "name": "Jazz Cafe",
        "desc": "Smooth jazz & bossa nova instrumental",
        "icon": "\U0001f3b7",
        "url": "https://www.youtube.com/watch?v=VMAPTo7RVCo",
    },
    "classical_focus": {
        "name": "Classical Focus",
        "desc": "Muzyka klasyczna do koncentracji",
        "icon": "\U0001f3bb",
        "url": "https://www.youtube.com/watch?v=jgpJVI3tDbY",
    },
    "synthwave": {
        "name": "Synthwave Radio",
        "desc": "Synthwave / retrowave instrumental",
        "icon": "\U0001f680",
        "url": "https://www.youtube.com/watch?v=4xDzrJKXOOY",
    },
    "piano_ambient": {
        "name": "Piano & Ambient",
        "desc": "Spokojne pianino i ambient",
        "icon": "\U0001f3b9",
        "url": "https://www.youtube.com/watch?v=77ZozI0rw7w",
    },
}


def is_available() -> bool:
    """Check if yt-dlp and ffplay are available."""
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return False
    return _find_ffplay() is not None


def _get_audio_url(video_url: str) -> str | None:
    """Extract direct audio stream URL using yt-dlp."""
    try:
        import yt_dlp

        ydl_opts = {
            "format": "bestaudio/best",
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            # Direct URL
            url = info.get("url")
            if url:
                return url
            # For live streams / manifests, try first format
            formats = info.get("formats")
            if formats:
                # Pick best audio-only, or last (usually best)
                for f in reversed(formats):
                    if f.get("acodec", "none") != "none" and f.get("url"):
                        return f["url"]
                # Fallback: last format with url
                for f in reversed(formats):
                    if f.get("url"):
                        return f["url"]
            return None
    except Exception:
        return None


def _start_ffplay(audio_url: str, station_key: str,
                  callback_started=None, callback_error=None):
    """Launch ffplay process with given audio URL. Must hold _lock or be thread-safe."""
    global _process, _current_station, _current_audio_url

    ffplay_path = _find_ffplay()
    if not ffplay_path:
        if callback_error:
            try:
                callback_error("ffplay nie znaleziony")
            except Exception:
                pass
        return False

    with _lock:
        try:
            cmd = [
                ffplay_path, "-nodisp", "-autoexit",
                "-loglevel", "quiet",
                "-volume", str(_volume),
                audio_url,
            ]
            _process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=0x08000000,  # CREATE_NO_WINDOW on Windows
            )
            _current_station = station_key
            _current_audio_url = audio_url
        except Exception as e:
            _current_station = None
            _current_audio_url = None
            if callback_error:
                try:
                    callback_error(str(e))
                except Exception:
                    pass
            return False

    if callback_started:
        try:
            callback_started(station_key)
        except Exception:
            pass
    return True


def play(station_key: str | None = None, custom_url: str | None = None,
         callback_started=None, callback_error=None):
    """Start playing a YouTube station in background thread."""
    global _generation

    url = None
    if station_key and station_key in STATIONS:
        url = STATIONS[station_key]["url"]
    elif custom_url:
        url = custom_url
        station_key = "custom"

    if not url:
        if callback_error:
            callback_error("Nie znaleziono stacji")
        return

    # Kill any existing playback and bump generation
    _kill_process()
    with _lock:
        _generation += 1
        my_gen = _generation

    def _start():
        audio_url = _get_audio_url(url)

        # Check if we were cancelled while fetching
        with _lock:
            if my_gen != _generation:
                return  # stale request, newer play/stop happened

        if not audio_url:
            if callback_error:
                try:
                    callback_error("Nie udalo sie pobrac audio z YouTube")
                except Exception:
                    pass
            return

        with _lock:
            if my_gen != _generation:
                return  # cancelled

        _start_ffplay(audio_url, station_key, callback_started, callback_error)

    threading.Thread(target=_start, daemon=True).start()


def _kill_process():
    """Kill ffplay process forcefully."""
    global _process, _current_station
    with _lock:
        proc = _process
        _process = None
        _current_station = None
        # Keep _current_audio_url for volume restart

    if proc is not None:
        try:
            proc.terminate()
        except Exception:
            pass
        try:
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def stop():
    """Stop current playback."""
    global _generation, _current_audio_url
    with _lock:
        _generation += 1
        _current_audio_url = None
    _kill_process()


def is_playing() -> bool:
    with _lock:
        if _process is None:
            return False
        return _process.poll() is None


def get_current() -> str | None:
    if is_playing():
        return _current_station
    return None


_vol_timer: threading.Timer | None = None


def set_volume(vol: int):
    """Set volume 0-100. If playing, restarts ffplay with cached URL after 0.5s debounce."""
    global _volume, _vol_timer
    new_vol = max(0, min(100, vol))
    if new_vol == _volume:
        return
    _volume = new_vol

    # Cancel pending restart
    if _vol_timer is not None:
        _vol_timer.cancel()
        _vol_timer = None

    # Check if playing and has cached audio URL
    with _lock:
        if (_process is not None and _process.poll() is None
                and _current_station is not None and _current_audio_url is not None):
            station = _current_station
            audio_url = _current_audio_url
        else:
            return

    def _apply():
        global _vol_timer
        _vol_timer = None
        # Quick restart: kill ffplay and relaunch with cached URL (no yt-dlp)
        _kill_process()
        _start_ffplay(audio_url, station)

    _vol_timer = threading.Timer(0.5, _apply)
    _vol_timer.daemon = True
    _vol_timer.start()


def get_volume() -> int:
    return _volume


def _cleanup():
    """Kill ffplay on interpreter exit."""
    try:
        _kill_process()
    except Exception:
        pass


atexit.register(_cleanup)


def search_youtube(query: str, limit: int = 5) -> list[dict]:
    """Search YouTube and return list of {title, duration, url}."""
    try:
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
            "default_search": f"ytsearch{limit}",
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
            results = []
            for entry in info.get("entries", []):
                if not entry:
                    continue
                dur = entry.get("duration") or 0
                m, s = divmod(int(dur), 60)
                results.append({
                    "title": entry.get("title", "Nieznany"),
                    "duration": f"{m}:{s:02d}",
                    "url": entry.get("webpage_url") or entry.get("url", ""),
                })
            return results
    except Exception:
        return []
