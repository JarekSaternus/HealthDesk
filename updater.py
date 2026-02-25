"""Auto-update system for HealthDesk — checks GitHub Releases for new versions."""

import json
import os
import subprocess
import sys
import tempfile
import threading
import urllib.request

import customtkinter as ctk

from config import APP_VERSION
from i18n import t

GITHUB_API = "https://api.github.com/repos/JarekSaternus/HealthDesk/releases/latest"
USER_AGENT = f"HealthDesk/{APP_VERSION}"


def _parse_version(tag: str) -> tuple[int, ...]:
    """Parse 'v1.2.3' or '1.2.3' into (1, 2, 3)."""
    tag = tag.lstrip("vV").strip()
    parts = []
    for p in tag.split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts)


def check_for_update(callback):
    """Check GitHub for a newer release in a background thread.

    Calls callback(result) on the calling thread's context with:
      {"available": True, "version": "1.2.0", "url": "...", "notes": "..."}
    or
      {"available": False}
    or
      {"error": "..."}
    """
    def _worker():
        try:
            req = urllib.request.Request(
                GITHUB_API,
                headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github.v3+json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            tag = data.get("tag_name", "")
            remote_ver = _parse_version(tag)
            local_ver = _parse_version(APP_VERSION)

            if remote_ver > local_ver:
                # Find the .exe asset
                download_url = ""
                for asset in data.get("assets", []):
                    name = asset.get("name", "")
                    if name.lower().endswith(".exe"):
                        download_url = asset.get("browser_download_url", "")
                        break

                callback({
                    "available": True,
                    "version": tag.lstrip("vV"),
                    "url": download_url,
                    "notes": data.get("body", ""),
                })
            else:
                callback({"available": False})
        except Exception as e:
            callback({"error": str(e)})

    threading.Thread(target=_worker, daemon=True).start()


def download_and_install(url: str, root: ctk.CTk, on_quit, progress_cb=None):
    """Download installer to %TEMP% and run it silently, then quit the app.

    progress_cb(percent: int) is called from a background thread — caller
    must marshal to the UI thread.
    """
    def _worker():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            resp = urllib.request.urlopen(req, timeout=60)

            total = int(resp.headers.get("Content-Length", 0))
            dest = os.path.join(tempfile.gettempdir(), "HealthDesk_Setup.exe")
            downloaded = 0
            chunk_size = 64 * 1024

            with open(dest, "wb") as f:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0 and progress_cb:
                        pct = min(int(downloaded * 100 / total), 100)
                        progress_cb(pct)

            # Launch silent installer and quit
            subprocess.Popen(
                [dest, "/SILENT", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"],
                creationflags=subprocess.DETACHED_PROCESS,
            )
            root.after(0, on_quit)
        except Exception:
            if progress_cb:
                progress_cb(-1)  # signal error

    threading.Thread(target=_worker, daemon=True).start()


# ---------------------------------------------------------------------------
#  Update Dialog
# ---------------------------------------------------------------------------

class UpdateDialog(ctk.CTkToplevel):
    """Modal-style dialog for checking / downloading updates."""

    WIDTH = 420
    HEIGHT = 320

    C_BG = "#1a1a2e"
    C_CARD = "#22223a"
    C_ACCENT = "#2ecc71"
    C_ACCENT_HOVER = "#27ae60"
    C_TEXT = "#e0e0e0"
    C_TEXT_DIM = "#888888"

    def __init__(self, root: ctk.CTk, on_quit):
        super().__init__(root)
        self.title(t("update.title"))
        self.geometry(f"{self.WIDTH}x{self.HEIGHT}")
        self.resizable(False, False)
        self.configure(fg_color=self.C_BG)
        self.attributes("-topmost", True)
        self.protocol("WM_DELETE_WINDOW", self._close)

        try:
            from generate_icon import generate_icon
            self.after(200, lambda: self.iconbitmap(generate_icon()))
        except Exception:
            pass

        self._root = root
        self._on_quit = on_quit
        self._download_url = ""

        # Container
        self._container = ctk.CTkFrame(self, fg_color=self.C_BG)
        self._container.pack(fill="both", expand=True, padx=20, pady=20)

        self._show_checking()

    def _clear(self):
        for w in self._container.winfo_children():
            w.destroy()

    def _show_checking(self):
        self._clear()
        ctk.CTkLabel(
            self._container, text=t("update.checking"),
            font=ctk.CTkFont(size=15), text_color=self.C_TEXT,
        ).pack(expand=True)

        # Start the check
        check_for_update(lambda result: self._root.after(0, self._on_result, result))

    def _on_result(self, result: dict):
        if not self.winfo_exists():
            return
        self._clear()

        if "error" in result:
            self._show_error()
        elif result.get("available"):
            self._show_available(result["version"], result.get("notes", ""), result.get("url", ""))
        else:
            self._show_up_to_date()

    def _show_up_to_date(self):
        ctk.CTkLabel(
            self._container,
            text=t("update.up_to_date", version=APP_VERSION),
            font=ctk.CTkFont(size=15), text_color=self.C_ACCENT,
            wraplength=self.WIDTH - 60,
        ).pack(expand=True)

        ctk.CTkButton(
            self._container, text="OK", width=120, height=36,
            fg_color=self.C_ACCENT, hover_color=self.C_ACCENT_HOVER,
            command=self._close,
        ).pack(pady=(0, 10))

    def _show_error(self):
        ctk.CTkLabel(
            self._container, text=t("update.error"),
            font=ctk.CTkFont(size=14), text_color="#e74c3c",
            wraplength=self.WIDTH - 60,
        ).pack(expand=True)

        ctk.CTkButton(
            self._container, text="OK", width=120, height=36,
            fg_color=self.C_ACCENT, hover_color=self.C_ACCENT_HOVER,
            command=self._close,
        ).pack(pady=(0, 10))

    def _show_available(self, version: str, notes: str, url: str):
        self._download_url = url

        ctk.CTkLabel(
            self._container,
            text=t("update.available", version=version),
            font=ctk.CTkFont(size=16, weight="bold"), text_color=self.C_ACCENT,
            wraplength=self.WIDTH - 60,
        ).pack(pady=(10, 8))

        if notes:
            notes_box = ctk.CTkTextbox(
                self._container, width=self.WIDTH - 60, height=120,
                fg_color=self.C_CARD, text_color=self.C_TEXT,
                font=ctk.CTkFont(size=12), corner_radius=8,
                activate_scrollbars=True,
            )
            notes_box.insert("1.0", notes[:2000])
            notes_box.configure(state="disabled")
            notes_box.pack(pady=(0, 10))

        ctk.CTkLabel(
            self._container, text=t("update.restart_note"),
            font=ctk.CTkFont(size=11), text_color=self.C_TEXT_DIM,
        ).pack(pady=(0, 8))

        btn_frame = ctk.CTkFrame(self._container, fg_color="transparent")
        btn_frame.pack(fill="x", pady=(0, 5))

        ctk.CTkButton(
            btn_frame, text=t("update.download"), width=180, height=38,
            fg_color=self.C_ACCENT, hover_color=self.C_ACCENT_HOVER,
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self._start_download,
        ).pack(side="left", expand=True, padx=(0, 5))

        ctk.CTkButton(
            btn_frame, text=t("update.later"), width=120, height=38,
            fg_color=self.C_CARD, hover_color="#333355",
            font=ctk.CTkFont(size=13),
            command=self._close,
        ).pack(side="right", expand=True, padx=(5, 0))

    def _start_download(self):
        if not self._download_url:
            self._close()
            return
        self._clear()

        self._dl_label = ctk.CTkLabel(
            self._container,
            text=t("update.downloading", percent=0),
            font=ctk.CTkFont(size=14), text_color=self.C_TEXT,
        )
        self._dl_label.pack(pady=(40, 15))

        self._progress = ctk.CTkProgressBar(
            self._container, width=self.WIDTH - 80,
            progress_color=self.C_ACCENT, height=14,
        )
        self._progress.set(0)
        self._progress.pack()

        def _on_progress(pct):
            self._root.after(0, self._update_progress, pct)

        download_and_install(
            self._download_url, self._root, self._on_quit,
            progress_cb=_on_progress,
        )

    def _update_progress(self, pct: int):
        if not self.winfo_exists():
            return
        if pct < 0:
            self._dl_label.configure(text=t("update.error"), text_color="#e74c3c")
            return
        self._progress.set(pct / 100.0)
        if pct >= 100:
            self._dl_label.configure(text=t("update.installing"))
        else:
            self._dl_label.configure(text=t("update.downloading", percent=pct))

    def _close(self):
        try:
            self.destroy()
        except Exception:
            pass
