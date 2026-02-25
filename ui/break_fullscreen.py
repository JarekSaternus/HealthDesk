import time
import webbrowser
import customtkinter as ctk
import database
from i18n import t


class BreakFullscreen(ctk.CTkToplevel):
    """Aggressive fullscreen break window."""

    def __init__(self, break_type: str = "big", duration_sec: int = 300, on_close=None):
        super().__init__()
        self.break_type = break_type
        self.duration_sec = duration_sec
        self.remaining = duration_sec
        self._on_close = on_close
        self._exit_clicks = []

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

        self.title(t("break_fs.window_title"))
        try:
            from generate_icon import generate_icon
            self.after(200, lambda: self.iconbitmap(generate_icon()))
        except Exception:
            pass
        self.attributes("-fullscreen", True)
        self.attributes("-topmost", True)
        self.configure(fg_color="#0d1117")
        self.protocol("WM_DELETE_WINDOW", lambda: None)
        self.bind("<Escape>", lambda e: None)

        if break_type == "small":
            icon = "\U0001f441"
            title = t("break_fs.small_title")
            desc = t("break_fs.small_desc")
            accent = "#3498db"
        else:
            icon = "\U0001f9d8"
            title = t("break_fs.big_title")
            desc = t("break_fs.big_desc")
            accent = "#2ecc71"

        # Centered content container
        container = ctk.CTkFrame(self, fg_color="transparent")
        container.place(relx=0.5, rely=0.45, anchor="center")

        ctk.CTkLabel(container, text=icon, font=ctk.CTkFont(size=64)).pack(pady=(0, 10))

        ctk.CTkLabel(container, text=title, font=ctk.CTkFont(size=52, weight="bold"),
                     text_color="#e8e8e8").pack(pady=(0, 15))

        ctk.CTkLabel(container, text=desc, font=ctk.CTkFont(size=20),
                     text_color="#8b949e", justify="center").pack(pady=(0, 30))

        self.label_timer = ctk.CTkLabel(container, text="",
                                        font=ctk.CTkFont(size=100, weight="bold"),
                                        text_color=accent)
        self.label_timer.pack(pady=(0, 20))

        self.progress = ctk.CTkProgressBar(container, width=500, height=12,
                                           progress_color=accent, fg_color="#1a1f29",
                                           corner_radius=6)
        self.progress.pack(pady=(0, 15))
        self.progress.set(1.0)

        self.label_motivate = ctk.CTkLabel(
            container, text="", font=ctk.CTkFont(size=14),
            text_color="#555d6b",
        )
        self.label_motivate.pack(pady=5)

        # Ad banner above exit label
        if self._ad:
            self._build_ad_banner()

        self.label_exit = ctk.CTkLabel(
            self, text=t("break_fs.exit_hint"),
            font=ctk.CTkFont(size=11),
            text_color="#30363d",
        )
        self.label_exit.pack(side="bottom", pady=20)

        self._motivational_messages = [
            t("break_fs.msg_eyes"),
            t("break_fs.msg_health"),
            t("break_fs.msg_breathe"),
            t("break_fs.msg_relax"),
            t("break_fs.msg_halfway"),
        ]
        self._msg_index = 0

        self.bind("<Button-1>", self._on_click)
        self._tick()

    def _build_ad_banner(self):
        ad = self._ad
        bg = ad.get("bg", "#1a2744")
        accent = ad.get("accent", "#f39c12")
        url = ad.get("url", "")

        banner = ctk.CTkFrame(self, fg_color=bg, corner_radius=10, height=50)
        banner.pack(side="bottom", fill="x", padx=60, pady=(0, 5))
        banner.pack_propagate(False)

        inner = ctk.CTkFrame(banner, fg_color="transparent")
        inner.pack(fill="both", expand=True, padx=20)

        ctk.CTkLabel(inner, text=ad.get("title", ""),
                     font=ctk.CTkFont(size=13, weight="bold"),
                     text_color=accent).pack(side="left", padx=(0, 12))

        ctk.CTkLabel(inner, text=ad.get("text", ""),
                     font=ctk.CTkFont(size=13),
                     text_color="#aaaaaa").pack(side="left", fill="x", expand=True)

        if url:
            link_btn = ctk.CTkButton(
                inner, text=f"{t('break_fs.check')} \u2192", width=90, height=32,
                corner_radius=8, fg_color=accent,
                hover_color="#d68910",
                font=ctk.CTkFont(size=12, weight="bold"),
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
        return f"{m}:{s:02d}"

    def _tick(self):
        if self.remaining <= 0:
            try:
                import audio_engine
                audio_engine.play_chime()
            except Exception:
                pass
            self._finish(skipped=False)
            return
        self.label_timer.configure(text=self._format_time())
        self.progress.set(self.remaining / self.duration_sec)

        # Show motivational messages every 20% of time
        pct = 1 - (self.remaining / self.duration_sec)
        idx = min(int(pct * len(self._motivational_messages)), len(self._motivational_messages) - 1)
        if idx != self._msg_index:
            self._msg_index = idx
            self.label_motivate.configure(text=self._motivational_messages[idx])

        self.remaining -= 1
        self.after(1000, self._tick)

    def _on_click(self, event):
        now = time.time()
        self._exit_clicks.append(now)
        self._exit_clicks = [t_ for t_ in self._exit_clicks if now - t_ <= 2.0]
        if len(self._exit_clicks) >= 3:
            self._finish(skipped=True)

    def _finish(self, skipped: bool):
        database.log_break(self.break_type, self.duration_sec, skipped=skipped)
        try:
            import telemetry
            event = "break_taken" if not skipped else "break_skipped"
            telemetry.track(event, {"break_type": self.break_type, "duration": self.duration_sec})
        except Exception:
            pass
        self.attributes("-fullscreen", False)
        self.destroy()
        if self._on_close:
            self._on_close()
