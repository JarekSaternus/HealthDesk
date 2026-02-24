"""YouTube search dialog for finding and playing music."""
import threading

import customtkinter as ctk

import yt_player

# Colors (same as main_window)
C_CARD = "#222836"
C_ACCENT = "#2ecc71"
C_ACCENT_HOVER = "#27ae60"
C_TEXT = "#e0e0e0"
C_TEXT_DIM = "#8b949e"
C_BTN_DARK = "#2d3748"
C_BTN_DARK_HOVER = "#3a4558"
C_CONTENT = "#1a1f2b"


class YouTubeSearchDialog(ctk.CTkToplevel):
    """Dialog for searching YouTube and selecting a track to play."""

    def __init__(self, parent, on_select_callback):
        super().__init__(parent)
        self._callback = on_select_callback
        self._destroyed = False

        self.title("Szukaj na YouTube")
        self.geometry("520x460")
        self.resizable(False, False)
        self.configure(fg_color=C_CONTENT)
        self.attributes("-topmost", True)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        x = (self.winfo_screenwidth() - 520) // 2
        y = (self.winfo_screenheight() - 460) // 2
        self.geometry(f"+{x}+{y}")

        self.protocol("WM_DELETE_WINDOW", self._close)

        self._build_ui()

    def _build_ui(self):
        # Header
        ctk.CTkLabel(
            self, text="\U0001f50d  Szukaj na YouTube",
            font=ctk.CTkFont(size=18, weight="bold"),
        ).pack(padx=20, pady=(16, 10), anchor="w")

        # Search row
        search_row = ctk.CTkFrame(self, fg_color="transparent")
        search_row.pack(fill="x", padx=20, pady=(0, 8))

        self._entry = ctk.CTkEntry(
            search_row, placeholder_text="Wpisz fraze...",
            height=36, font=ctk.CTkFont(size=13),
        )
        self._entry.pack(side="left", fill="x", expand=True, padx=(0, 8))
        self._entry.bind("<Return>", lambda e: self._do_search())

        self._search_btn = ctk.CTkButton(
            search_row, text="Szukaj", width=80, height=36,
            corner_radius=8, fg_color=C_ACCENT, hover_color=C_ACCENT_HOVER,
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self._do_search,
        )
        self._search_btn.pack(side="right")

        # Status
        self._status = ctk.CTkLabel(
            self, text="", font=ctk.CTkFont(size=12),
            text_color=C_TEXT_DIM,
        )
        self._status.pack(padx=20, anchor="w")

        # Results area
        self._results_frame = ctk.CTkScrollableFrame(
            self, fg_color="transparent", corner_radius=8,
        )
        self._results_frame.pack(fill="both", expand=True, padx=15, pady=(5, 8))

        # Close button
        ctk.CTkButton(
            self, text="Zamknij", width=100, height=32,
            corner_radius=8, fg_color=C_BTN_DARK, hover_color=C_BTN_DARK_HOVER,
            command=self._close,
        ).pack(pady=(0, 12))

        self._entry.focus_set()

    def _do_search(self):
        query = self._entry.get().strip()
        if not query:
            return
        self._search_btn.configure(state="disabled")
        self._status.configure(text="Szukam...", text_color=C_TEXT_DIM)
        # Clear old results
        for w in self._results_frame.winfo_children():
            w.destroy()

        def _bg():
            results = yt_player.search_youtube(query, limit=5)
            if not self._destroyed:
                try:
                    self.after(0, self._show_results, results)
                except Exception:
                    pass

        threading.Thread(target=_bg, daemon=True).start()

    def _show_results(self, results: list[dict]):
        if self._destroyed:
            return
        self._search_btn.configure(state="normal")

        if not results:
            self._status.configure(text="Brak wynikow", text_color="#e74c3c")
            return

        self._status.configure(
            text=f"Znaleziono {len(results)} wynikow", text_color=C_ACCENT,
        )

        for r in results:
            card = ctk.CTkFrame(self._results_frame, fg_color=C_CARD, corner_radius=10)
            card.pack(fill="x", pady=3)

            inner = ctk.CTkFrame(card, fg_color="transparent")
            inner.pack(fill="x", padx=10, pady=8)

            text_frame = ctk.CTkFrame(inner, fg_color="transparent")
            text_frame.pack(side="left", fill="x", expand=True)

            ctk.CTkLabel(
                text_frame, text=r["title"],
                font=ctk.CTkFont(size=12, weight="bold"),
                text_color=C_TEXT, wraplength=340, anchor="w", justify="left",
            ).pack(anchor="w")

            ctk.CTkLabel(
                text_frame, text=r["duration"],
                font=ctk.CTkFont(size=11), text_color=C_TEXT_DIM,
            ).pack(anchor="w")

            url = r["url"]
            ctk.CTkButton(
                inner, text="\u25b6 Graj", width=65, height=30,
                corner_radius=8, fg_color="#9b59b6", hover_color="#8e44ad",
                font=ctk.CTkFont(size=12, weight="bold"),
                command=lambda u=url: self._select(u),
            ).pack(side="right", padx=(8, 0))

    def _select(self, url: str):
        self._close()
        if self._callback:
            self._callback(url)

    def _close(self):
        self._destroyed = True
        try:
            self.grab_release()
        except Exception:
            pass
        self.destroy()
