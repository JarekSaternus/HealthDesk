"""Auto-update system for HealthDesk — checks GitHub Releases for new versions."""

import json
import os
import subprocess
import tempfile
import threading
import urllib.request

from config import APP_VERSION

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

    Calls callback(result) with:
      {"available": True, "version": "1.2.0", "url": "...", "notes": "..."}
    or {"available": False}
    or {"error": "..."}
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


def download_update(url: str, progress_cb=None):
    """Download installer to %TEMP%. Returns path on success, None on failure.

    progress_cb(percent: int) called from background thread.
    """
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        resp = urllib.request.urlopen(req, timeout=120)

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

        return dest
    except Exception:
        return None


def install_and_quit(installer_path: str, on_quit):
    """Launch silent installer and quit the app."""
    try:
        subprocess.Popen(
            [installer_path, "/SILENT", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"],
            creationflags=subprocess.DETACHED_PROCESS,
        )
    except Exception:
        pass
    on_quit()


# ---------------------------------------------------------------------------
#  Update Dialog (standalone tkinter — no customtkinter dependency)
# ---------------------------------------------------------------------------

def show_update_dialog(root, on_quit):
    """Show update check dialog. Safe to call from any thread via root.after()."""
    import customtkinter as ctk
    from i18n import t

    C_BG = "#1a1a2e"
    C_CARD = "#22223a"
    C_ACCENT = "#2ecc71"
    C_ACCENT_HOVER = "#27ae60"
    C_TEXT = "#e0e0e0"
    C_TEXT_DIM = "#888888"

    dialog = ctk.CTkToplevel(root)
    dialog.title(t("update.title"))
    dialog.geometry("420x320")
    dialog.resizable(False, False)
    dialog.configure(fg_color=C_BG)
    dialog.attributes("-topmost", True)

    try:
        from generate_icon import generate_icon
        dialog.after(200, lambda: dialog.iconbitmap(generate_icon()))
    except Exception:
        pass

    container = ctk.CTkFrame(dialog, fg_color=C_BG)
    container.pack(fill="both", expand=True, padx=20, pady=20)

    def _clear():
        for w in container.winfo_children():
            w.destroy()

    def _close():
        try:
            dialog.destroy()
        except Exception:
            pass

    dialog.protocol("WM_DELETE_WINDOW", _close)

    # --- Show checking state ---
    checking_label = ctk.CTkLabel(
        container, text=t("update.checking"),
        font=ctk.CTkFont(size=15), text_color=C_TEXT,
    )
    checking_label.pack(expand=True)

    def _on_result(result):
        try:
            if not dialog.winfo_exists():
                return
        except Exception:
            return
        _clear()

        if "error" in result:
            ctk.CTkLabel(
                container, text=t("update.error"),
                font=ctk.CTkFont(size=14), text_color="#e74c3c",
                wraplength=360,
            ).pack(expand=True)
            ctk.CTkButton(
                container, text="OK", width=120, height=36,
                fg_color=C_ACCENT, hover_color=C_ACCENT_HOVER,
                command=_close,
            ).pack(pady=(0, 10))

        elif result.get("available"):
            version = result["version"]
            url = result.get("url", "")
            notes = result.get("notes", "")

            ctk.CTkLabel(
                container,
                text=t("update.available", version=version),
                font=ctk.CTkFont(size=16, weight="bold"), text_color=C_ACCENT,
                wraplength=360,
            ).pack(pady=(10, 8))

            if notes:
                notes_box = ctk.CTkTextbox(
                    container, width=360, height=120,
                    fg_color=C_CARD, text_color=C_TEXT,
                    font=ctk.CTkFont(size=12), corner_radius=8,
                )
                notes_box.insert("1.0", notes[:2000])
                notes_box.configure(state="disabled")
                notes_box.pack(pady=(0, 10))

            ctk.CTkLabel(
                container, text=t("update.restart_note"),
                font=ctk.CTkFont(size=11), text_color=C_TEXT_DIM,
            ).pack(pady=(0, 8))

            btn_frame = ctk.CTkFrame(container, fg_color="transparent")
            btn_frame.pack(fill="x", pady=(0, 5))

            ctk.CTkButton(
                btn_frame, text=t("update.download"), width=180, height=38,
                fg_color=C_ACCENT, hover_color=C_ACCENT_HOVER,
                font=ctk.CTkFont(size=13, weight="bold"),
                command=lambda: _start_download(url),
            ).pack(side="left", expand=True, padx=(0, 5))

            ctk.CTkButton(
                btn_frame, text=t("update.later"), width=120, height=38,
                fg_color=C_CARD, hover_color="#333355",
                font=ctk.CTkFont(size=13),
                command=_close,
            ).pack(side="right", expand=True, padx=(5, 0))

        else:
            ctk.CTkLabel(
                container,
                text=t("update.up_to_date", version=APP_VERSION),
                font=ctk.CTkFont(size=15), text_color=C_ACCENT,
                wraplength=360,
            ).pack(expand=True)
            ctk.CTkButton(
                container, text="OK", width=120, height=36,
                fg_color=C_ACCENT, hover_color=C_ACCENT_HOVER,
                command=_close,
            ).pack(pady=(0, 10))

    def _start_download(url):
        _clear()

        dl_label = ctk.CTkLabel(
            container,
            text=t("update.downloading", percent=0),
            font=ctk.CTkFont(size=14), text_color=C_TEXT,
        )
        dl_label.pack(pady=(40, 15))

        progress = ctk.CTkProgressBar(
            container, width=340,
            progress_color=C_ACCENT, height=14,
        )
        progress.set(0)
        progress.pack()

        def _on_progress(pct):
            root.after(0, _update_progress, pct)

        def _update_progress(pct):
            try:
                if not dialog.winfo_exists():
                    return
            except Exception:
                return
            if pct < 0:
                dl_label.configure(text=t("update.error"), text_color="#e74c3c")
                return
            progress.set(pct / 100.0)
            if pct >= 100:
                dl_label.configure(text=t("update.installing"))
            else:
                dl_label.configure(text=t("update.downloading", percent=pct))

        def _download_thread():
            path = download_update(url, progress_cb=_on_progress)
            if path:
                root.after(0, lambda: install_and_quit(path, on_quit))
            else:
                _on_progress(-1)

        threading.Thread(target=_download_thread, daemon=True).start()

    # Start the check
    def _safe_result(result):
        root.after(0, _on_result, result)

    check_for_update(_safe_result)
