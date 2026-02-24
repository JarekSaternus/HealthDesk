import threading
import time
import ctypes
import ctypes.wintypes
import os

import database

# Category mapping: process name keywords -> category
CATEGORY_MAP = {
    "Praca": [
        "code", "visual studio", "pycharm", "intellij", "eclipse", "sublime",
        "notepad++", "vim", "word", "excel", "powerpoint", "outlook",
        "onenote", "publisher", "access", "devenv", "rider", "webstorm",
    ],
    "Rozrywka": [
        "youtube", "netflix", "spotify", "twitch", "steam", "epic games",
        "discord", "game", "gra", "player", "vlc", "media",
    ],
    "Komunikacja": [
        "teams", "slack", "zoom", "skype", "thunderbird", "mail",
        "messenger", "telegram", "whatsapp", "signal",
    ],
    "Przeglądarka": [
        "chrome", "firefox", "edge", "opera", "brave", "safari",
    ],
}

# Browser window title keywords -> override category
# Checked when process is a browser to sub-classify by page content
BROWSER_TITLE_MAP = {
    "Praca": [
        "github", "gitlab", "bitbucket", "stackoverflow", "stack overflow",
        "jira", "confluence", "notion", "trello", "asana", "linear",
        "figma", "canva", "docs.google", "google docs", "sheets", "slides",
        "overleaf", "codepen", "codesandbox", "replit", "vercel", "netlify",
        "aws", "azure", "docker", "kubernetes", "jenkins", "circleci",
        "chatgpt", "claude", "copilot", "perplexity",
        "mdn", "w3schools", "devdocs", "documentation", "api reference",
        "pull request", "merge request", "issues", "commit",
    ],
    "Rozrywka": [
        "youtube", "netflix", "twitch", "hbo", "disney", "prime video",
        "tiktok", "reddit", "9gag", "imgur", "twitter", "x.com",
        "facebook", "instagram", "pinterest",
        "steam", "gog.com", "epicgames", "itch.io",
        "spotify", "soundcloud", "deezer",
    ],
    "Komunikacja": [
        "gmail", "outlook", "mail", "poczta", "wp.pl",
        "slack", "teams", "zoom", "meet.google", "google meet",
        "messenger", "whatsapp", "telegram", "signal",
        "discord",
    ],
}

BROWSER_PROCESSES = {"chrome", "firefox", "msedge", "opera", "brave", "safari", "vivaldi", "arc"}


def _categorize(process_name: str, window_title: str) -> str:
    proc_lower = process_name.lower()
    title_lower = window_title.lower()

    # For browsers: analyze page title first for smarter classification
    if proc_lower in BROWSER_PROCESSES:
        for category, keywords in BROWSER_TITLE_MAP.items():
            for kw in keywords:
                if kw in title_lower:
                    return category
        # No specific match - generic browser usage
        return "Przeglądarka"

    # Non-browser: match by process name + title
    combined = proc_lower + " " + title_lower
    for category, keywords in CATEGORY_MAP.items():
        for kw in keywords:
            if kw in combined:
                return category
    return "Inne"


def _get_foreground_window_info() -> tuple[str, str]:
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return ("", "")

        # Get window title
        length = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value

        # Get process name
        pid = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        kernel32 = ctypes.windll.kernel32
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if handle:
            buf = ctypes.create_unicode_buffer(260)
            size = ctypes.wintypes.DWORD(260)
            kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size))
            kernel32.CloseHandle(handle)
            process_name = os.path.basename(buf.value).replace(".exe", "")
        else:
            process_name = ""

        return (process_name, title)
    except Exception:
        return ("", "")


class WindowTracker:
    def __init__(self, interval: int = 5):
        self.interval = interval
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _run(self):
        from config import load_config
        while self._running:
            process_name, title = _get_foreground_window_info()
            if process_name:
                category = _categorize(process_name, title)
                # Privacy: only store window title if user opted in
                stored_title = title if load_config().get("track_window_titles", False) else ""
                try:
                    database.log_activity(process_name, stored_title, self.interval, category)
                except Exception:
                    pass
            time.sleep(self.interval)
