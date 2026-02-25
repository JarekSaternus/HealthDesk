import customtkinter as ctk
import database
from i18n import t


class WaterReminderWindow(ctk.CTkToplevel):
    def __init__(self, daily_goal: int = 8, on_close=None):
        super().__init__()
        self._on_close = on_close
        self.daily_goal = daily_goal

        try:
            import audio_engine
            audio_engine.play_start_chime()
        except Exception:
            pass

        self.title(t("water.window_title"))
        try:
            from generate_icon import generate_icon
            self.after(200, lambda: self.iconbitmap(generate_icon()))
        except Exception:
            pass
        self.geometry("370x300")
        self.resizable(False, False)
        self.attributes("-topmost", True)

        # Bottom-right corner positioning
        self.update_idletasks()
        x = self.winfo_screenwidth() - 400
        y = self.winfo_screenheight() - 370
        self.geometry(f"+{x}+{y}")

        current = database.get_water_today()

        # Header
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(pady=(20, 5))
        ctk.CTkLabel(header, text="\U0001f4a7", font=ctk.CTkFont(size=28)).pack(side="left", padx=(0, 8))
        ctk.CTkLabel(header, text=t("water.time_to_drink"),
                     font=ctk.CTkFont(size=20, weight="bold")).pack(side="left")

        # Progress card
        card = ctk.CTkFrame(self, corner_radius=12, fg_color="#1e2530")
        card.pack(fill="x", padx=25, pady=15)

        # Glasses display
        glasses_frame = ctk.CTkFrame(card, fg_color="transparent")
        glasses_frame.pack(pady=(15, 5))

        # Show filled/empty glass indicators
        for i in range(daily_goal):
            color = "#3498db" if i < current else "#2d3748"
            ctk.CTkLabel(glasses_frame, text="\u25cf", font=ctk.CTkFont(size=18),
                         text_color=color).pack(side="left", padx=2)

        ctk.CTkLabel(card, text=t("water.glasses_count", current=current, goal=daily_goal),
                     font=ctk.CTkFont(size=15, weight="bold")).pack(pady=(5, 3))

        self.progress = ctk.CTkProgressBar(card, width=260, height=10,
                                           progress_color="#3498db", fg_color="#2d3748",
                                           corner_radius=5)
        self.progress.pack(pady=(3, 15))
        self.progress.set(min(current / max(daily_goal, 1), 1.0))

        if current >= daily_goal:
            ctk.CTkLabel(self, text=t("water.goal_reached"),
                         font=ctk.CTkFont(size=13, weight="bold"),
                         text_color="#2ecc71").pack(pady=(0, 5))

        # Buttons
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.pack(pady=10)

        ctk.CTkButton(
            btn_frame, text=f"\U0001f4a7 {t('water.drank')}", command=self._drink,
            fg_color="#3498db", hover_color="#2980b9",
            width=140, height=38, corner_radius=10,
            font=ctk.CTkFont(size=14, weight="bold"),
        ).pack(side="left", padx=8)

        ctk.CTkButton(
            btn_frame, text=t("water.later"), command=self._close,
            fg_color="transparent", hover_color="#3a3a4a",
            border_width=1, border_color="#555555",
            width=80, height=38, corner_radius=10,
            text_color="#999999",
        ).pack(side="left", padx=8)

        self.protocol("WM_DELETE_WINDOW", self._close)
        self.after(30000, self._close)

    def _drink(self):
        database.log_water(1)
        try:
            import telemetry
            telemetry.track("water_logged")
        except Exception:
            pass
        self.destroy()
        if self._on_close:
            self._on_close()

    def _close(self):
        self.destroy()
        if self._on_close:
            self._on_close()
