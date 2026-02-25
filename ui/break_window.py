import webbrowser
import customtkinter as ctk
import database
from i18n import t


class BreakWindow(ctk.CTkToplevel):
    """Moderate break popup - always on top with countdown timer."""

    def __init__(self, break_type: str = "small", duration_sec: int = 20, on_close=None):
        super().__init__()
        self.break_type = break_type
        self.duration_sec = duration_sec
        self.remaining = duration_sec
        self._on_close = on_close
        self._skipped = False

        # Play start chime
        try:
            import audio_engine
            audio_engine.play_start_chime()
        except Exception:
            pass

        # Get ad
        self._ad = None
        try:
            import ads
            self._ad = ads.get_ad()
        except Exception:
            pass

        win_h = 390 if self._ad else 340

        self.title(t("break.window_title"))
        try:
            from generate_icon import generate_icon
            self.after(200, lambda: self.iconbitmap(generate_icon()))
        except Exception:
            pass
        self.geometry(f"460x{win_h}")
        self.resizable(False, False)
        self.attributes("-topmost", True)
        self.protocol("WM_DELETE_WINDOW", self._skip)

        # Center on screen
        self.update_idletasks()
        x = (self.winfo_screenwidth() - 460) // 2
        y = (self.winfo_screenheight() - win_h) // 2
        self.geometry(f"+{x}+{y}")

        if break_type == "small":
            icon = "\U0001f441"
            title = t("break.small_title")
            desc = t("break.small_desc")
            accent = "#3498db"
            accent_hover = "#2980b9"
        else:
            icon = "\U0001f9d8"
            title = t("break.big_title")
            minutes = duration_sec // 60
            desc = t("break.big_desc", minutes=minutes)
            accent = "#e67e22"
            accent_hover = "#d35400"

        # Icon + title row
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(pady=(25, 5))
        ctk.CTkLabel(header, text=icon, font=ctk.CTkFont(size=32)).pack(side="left", padx=(0, 10))
        ctk.CTkLabel(header, text=title, font=ctk.CTkFont(size=22, weight="bold")).pack(side="left")

        ctk.CTkLabel(self, text=desc, font=ctk.CTkFont(size=14),
                     text_color="#aaaaaa").pack(pady=(5, 10))

        # Timer
        self.label_timer = ctk.CTkLabel(
            self, text=self._format_time(),
            font=ctk.CTkFont(size=56, weight="bold"),
            text_color=accent,
        )
        self.label_timer.pack(pady=5)

        # Progress bar
        self.progress = ctk.CTkProgressBar(self, width=300, height=8,
                                           progress_color=accent, fg_color="#2d2d3e")
        self.progress.pack(pady=(5, 15))
        self.progress.set(1.0)

        # Buttons
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.pack(pady=5)

        ctk.CTkButton(
            btn_frame, text=t("break.accept"), command=self._accept,
            fg_color=accent, hover_color=accent_hover,
            width=170, height=38, corner_radius=10,
            font=ctk.CTkFont(size=14, weight="bold"),
        ).pack(side="left", padx=8)

        ctk.CTkButton(
            btn_frame, text=t("break.skip"), command=self._skip,
            fg_color="transparent", hover_color="#3a3a4a",
            border_width=1, border_color="#555555",
            width=90, height=38, corner_radius=10,
            font=ctk.CTkFont(size=13),
            text_color="#999999",
        ).pack(side="left", padx=8)

        # Ad banner at bottom
        if self._ad:
            self._build_ad_banner()

        self._tick()

    def _build_ad_banner(self):
        ad = self._ad
        bg = ad.get("bg", "#1a2744")
        accent = ad.get("accent", "#f39c12")
        url = ad.get("url", "")

        banner = ctk.CTkFrame(self, fg_color=bg, corner_radius=8, height=44)
        banner.pack(fill="x", padx=12, pady=(5, 8), side="bottom")
        banner.pack_propagate(False)

        inner = ctk.CTkFrame(banner, fg_color="transparent")
        inner.pack(fill="both", expand=True, padx=10)

        ctk.CTkLabel(inner, text=ad.get("title", ""),
                     font=ctk.CTkFont(size=11, weight="bold"),
                     text_color=accent).pack(side="left", padx=(0, 8))

        ctk.CTkLabel(inner, text=ad.get("text", ""),
                     font=ctk.CTkFont(size=11),
                     text_color="#aaaaaa").pack(side="left", fill="x", expand=True)

        if url:
            link_btn = ctk.CTkButton(
                inner, text="\u2192", width=28, height=28,
                corner_radius=14, fg_color=accent,
                hover_color="#d68910",
                font=ctk.CTkFont(size=12),
                command=lambda: self._open_ad_url(ad),
            )
            link_btn.pack(side="right")

    def _open_ad_url(self, ad: dict):
        url = ad.get("url", "")
        try:
            from ads import is_safe_url, report_click
            if not is_safe_url(url):
                return
            ad_id = ad.get("id", 0)
            if ad_id:
                report_click(ad_id)
        except Exception:
            pass
        webbrowser.open(url)

    def _format_time(self) -> str:
        m, s = divmod(self.remaining, 60)
        if m > 0:
            return f"{m}:{s:02d}"
        return f"{s}s"

    def _tick(self):
        if self.remaining <= 0:
            try:
                import audio_engine
                audio_engine.play_chime()
            except Exception:
                pass
            self._accept()
            return
        self.label_timer.configure(text=self._format_time())
        self.progress.set(self.remaining / self.duration_sec)
        self.remaining -= 1
        self.after(1000, self._tick)

    def _accept(self):
        database.log_break(self.break_type, self.duration_sec, skipped=False)
        try:
            import telemetry
            telemetry.track("break_taken", {"break_type": self.break_type, "duration": self.duration_sec})
        except Exception:
            pass
        self.destroy()
        if self._on_close:
            self._on_close()

    def _skip(self):
        database.log_break(self.break_type, self.duration_sec, skipped=True)
        try:
            import telemetry
            telemetry.track("break_skipped", {"break_type": self.break_type})
        except Exception:
            pass
        self._skipped = True
        self.destroy()
        if self._on_close:
            self._on_close()
