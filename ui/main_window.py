"""Unified main window with sidebar navigation."""
import time
import tkinter as tk

import customtkinter as ctk

import audio_engine
import yt_player
import database
from config import save_config, set_autostart
from i18n import t
from ui.yt_search_dialog import YouTubeSearchDialog


# --- Colors ---
C_SIDEBAR = "#141821"
C_SIDEBAR_HOVER = "#1c2230"
C_SIDEBAR_ACTIVE = "#1e2636"
C_CONTENT = "#1a1f2b"
C_CARD = "#222836"
C_BOTTOM = "#111620"
C_ACCENT = "#2ecc71"
C_ACCENT_HOVER = "#27ae60"
C_TEXT = "#e0e0e0"
C_TEXT_DIM = "#8b949e"
C_BLUE = "#3498db"
C_ORANGE = "#e67e22"
C_RED = "#e74c3c"
C_BTN_DARK = "#2d3748"
C_BTN_DARK_HOVER = "#3a4558"

STAT_COLORS = {
    "Praca": "#2ecc71",
    "Rozrywka": "#e74c3c",
    "Komunikacja": "#3498db",
    "Przeglądarka": "#f39c12",
    "Inne": "#95a5a6",
}


def _fmt_dur(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, _ = divmod(rem, 60)
    if h > 0:
        return f"{h}h {m}min"
    return f"{m}min"


def _fmt_countdown(seconds_left: float) -> str:
    if seconds_left <= 0:
        return t("home.now")
    m, s = divmod(int(seconds_left), 60)
    return f"{m}:{s:02d}"


class MainWindow(ctk.CTkToplevel):
    """Single unified window with sidebar navigation."""

    PAGE_KEYS = [
        ("home", "\U0001f3e0", "nav.home"),
        ("stats", "\U0001f4ca", "nav.stats"),
        ("music", "\U0001f3b5", "nav.music"),
        ("settings", "\u2699", "nav.settings"),
        ("help", "\u2753", "nav.help"),
    ]

    def __init__(self, app_ref):
        super().__init__()
        self.app = app_ref
        self._destroyed = False
        self._current_page = "home"
        self._nav_buttons: dict[str, ctk.CTkButton] = {}
        self._pages: dict[str, ctk.CTkFrame] = {}
        self._music_btns: dict[str, ctk.CTkButton] = {}
        self._yt_btns: dict[str, ctk.CTkButton] = {}
        self._yt_available = yt_player.is_available()
        self._last_water_count = -1
        self._last_small_text = ""
        self._last_big_text = ""

        self.title("HealthDesk")
        try:
            from generate_icon import generate_icon
            self.after(200, lambda: self.iconbitmap(generate_icon()))
        except Exception:
            pass
        self.geometry("820x620")
        self.minsize(700, 500)
        self.configure(fg_color=C_CONTENT)
        self.attributes("-topmost", True)

        self.update_idletasks()
        x = (self.winfo_screenwidth() - 820) // 2
        y = (self.winfo_screenheight() - 620) // 2
        self.geometry(f"+{x}+{y}")

        self.protocol("WM_DELETE_WINDOW", self._close)

        # ---- Layout: sidebar | content | bottom bar ----
        self._build_layout()
        self._show_page("home")
        self._update_loop()

    # =========================================================================
    #  LAYOUT
    # =========================================================================
    def _build_layout(self):
        # Top container (sidebar + content)
        top = ctk.CTkFrame(self, fg_color="transparent")
        top.pack(fill="both", expand=True)

        # -- Sidebar --
        self.sidebar = ctk.CTkFrame(top, width=150, fg_color=C_SIDEBAR, corner_radius=0)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        # App title in sidebar
        title_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        title_frame.pack(fill="x", padx=10, pady=(14, 18))
        ctk.CTkLabel(title_frame, text="\U0001f7e2", font=ctk.CTkFont(size=14)).pack(side="left", padx=(4, 6))
        ctk.CTkLabel(title_frame, text="HealthDesk",
                     font=ctk.CTkFont(size=15, weight="bold"),
                     text_color=C_TEXT).pack(side="left")

        # Nav buttons
        for page_id, icon, label_key in self.PAGE_KEYS:
            btn = ctk.CTkButton(
                self.sidebar, text=f" {icon}  {t(label_key)}",
                anchor="w", height=38,
                font=ctk.CTkFont(size=13),
                fg_color="transparent", hover_color=C_SIDEBAR_HOVER,
                text_color=C_TEXT_DIM, corner_radius=8,
                command=lambda pid=page_id: self._show_page(pid),
            )
            btn.pack(fill="x", padx=8, pady=1)
            self._nav_buttons[page_id] = btn

        # Spacer
        ctk.CTkFrame(self.sidebar, fg_color="transparent", height=1).pack(fill="both", expand=True)

        # Quick actions
        sep = ctk.CTkFrame(self.sidebar, fg_color="#222836", height=1)
        sep.pack(fill="x", padx=12, pady=(0, 8))

        ctk.CTkButton(
            self.sidebar, text=f"\U0001f4a7  {t('nav.water_plus')}", height=32,
            font=ctk.CTkFont(size=12), anchor="w",
            fg_color="transparent", hover_color=C_SIDEBAR_HOVER,
            text_color=C_BLUE, corner_radius=8,
            command=self._quick_water,
        ).pack(fill="x", padx=8, pady=1)

        self.pause_sidebar_btn = ctk.CTkButton(
            self.sidebar, text=f"\u23f8  {t('nav.pause')}", height=32,
            font=ctk.CTkFont(size=12), anchor="w",
            fg_color="transparent", hover_color=C_SIDEBAR_HOVER,
            text_color=C_ORANGE, corner_radius=8,
            command=self._toggle_pause,
        )
        self.pause_sidebar_btn.pack(fill="x", padx=8, pady=(1, 10))

        # -- Content area --
        self.content = ctk.CTkFrame(top, fg_color=C_CONTENT, corner_radius=0)
        self.content.pack(side="left", fill="both", expand=True)

        # Build all pages (hidden)
        self._pages["home"] = self._build_home_page()
        self._pages["stats"] = self._build_stats_page()
        self._pages["music"] = self._build_music_page()
        self._pages["settings"] = self._build_settings_page()
        self._pages["help"] = self._build_help_page()

        # -- Bottom bar --
        self.bottom_bar = ctk.CTkFrame(self, height=40, fg_color=C_BOTTOM, corner_radius=0)
        self.bottom_bar.pack(fill="x", side="bottom")
        self.bottom_bar.pack_propagate(False)

        self.bottom_music_label = ctk.CTkLabel(
            self.bottom_bar, text="\U0001f3b5 --", font=ctk.CTkFont(size=11),
            text_color=C_TEXT_DIM)
        self.bottom_music_label.pack(side="left", padx=(14, 0))

        self.bottom_vol_slider = ctk.CTkSlider(
            self.bottom_bar, from_=0, to=100, number_of_steps=20,
            width=100, height=12,
            button_color=C_ACCENT, button_hover_color=C_ACCENT_HOVER,
            progress_color=C_ACCENT,
            command=self._on_bottom_volume,
        )
        self.bottom_vol_slider.set(audio_engine.get_volume() * 100)
        self.bottom_vol_slider.pack(side="left", padx=(10, 0))

        self.bottom_vol_label = ctk.CTkLabel(
            self.bottom_bar, text=f"{int(audio_engine.get_volume()*100)}%",
            font=ctk.CTkFont(size=10), text_color=C_TEXT_DIM, width=30)
        self.bottom_vol_label.pack(side="left", padx=(4, 0))

        self.bottom_status = ctk.CTkLabel(
            self.bottom_bar, text="", font=ctk.CTkFont(size=11),
            text_color=C_TEXT_DIM)
        self.bottom_status.pack(side="right", padx=(0, 14))

    # =========================================================================
    #  NAVIGATION
    # =========================================================================
    def _show_page(self, page_id: str):
        # Hide all
        for pid, frame in self._pages.items():
            frame.pack_forget()

        # Show selected
        self._pages[page_id].pack(in_=self.content, fill="both", expand=True)
        self._current_page = page_id

        # Update nav button styles
        for pid, btn in self._nav_buttons.items():
            if pid == page_id:
                btn.configure(fg_color=C_SIDEBAR_ACTIVE, text_color=C_ACCENT)
            else:
                btn.configure(fg_color="transparent", text_color=C_TEXT_DIM)

        # Refresh data when switching to stats
        if page_id == "stats":
            self._refresh_stats()

    # =========================================================================
    #  HOME PAGE
    # =========================================================================
    def _build_home_page(self) -> ctk.CTkFrame:
        page = ctk.CTkFrame(self.content, fg_color="transparent")

        main = ctk.CTkScrollableFrame(page, fg_color="transparent",
                                       scrollbar_button_color="#1a1f2b",
                                       scrollbar_button_hover_color="#333")
        main.pack(fill="both", expand=True, padx=15, pady=10)

        # --- Work time card ---
        card = self._card(main)
        row = ctk.CTkFrame(card, fg_color="transparent")
        row.pack(fill="x", padx=18, pady=14)

        left = ctk.CTkFrame(row, fg_color="transparent")
        left.pack(side="left")
        ctk.CTkLabel(left, text=f"\U0001f5a5  {t('home.work_time_today')}",
                     font=ctk.CTkFont(size=13)).pack(anchor="w")
        self.home_work_time = ctk.CTkLabel(left, text="0min",
                                           font=ctk.CTkFont(size=28, weight="bold"),
                                           text_color=C_ACCENT)
        self.home_work_time.pack(anchor="w")

        right = ctk.CTkFrame(row, fg_color="transparent")
        right.pack(side="right")
        ctk.CTkLabel(right, text=t("home.breaks"), font=ctk.CTkFont(size=12),
                     text_color=C_TEXT_DIM).pack()
        self.home_breaks = ctk.CTkLabel(right, text="0 / 0",
                                        font=ctk.CTkFont(size=16, weight="bold"))
        self.home_breaks.pack()

        # --- Break timers ---
        card = self._card(main)
        break_header = ctk.CTkFrame(card, fg_color="transparent")
        break_header.pack(fill="x", padx=18, pady=(14, 6))
        ctk.CTkLabel(break_header, text=f"\u23f1  {t('home.next_break')}",
                     font=ctk.CTkFont(size=13)).pack(side="left")

        method_key = self.app.config.get("work_method", "pomodoro")
        method_names = {"pomodoro": "Pomodoro", "20-20-20": "20-20-20",
                        "52-17": "52-17", "90-min": "90 min", "custom": t("settings.method_custom")}
        ctk.CTkLabel(break_header, text=method_names.get(method_key, method_key),
                     font=ctk.CTkFont(size=11), text_color=C_ACCENT,
                     corner_radius=6, fg_color="#162030",
                     padx=8, pady=2).pack(side="right")

        timers = ctk.CTkFrame(card, fg_color="transparent")
        timers.pack(fill="x", padx=18, pady=(0, 14))

        small_f = ctk.CTkFrame(timers, fg_color="#162030", corner_radius=10)
        small_f.pack(side="left", expand=True, fill="x", padx=(0, 4))
        ctk.CTkLabel(small_f, text=t("home.small_break"), font=ctk.CTkFont(size=11),
                     text_color=C_TEXT_DIM).pack(pady=(8, 0))
        self.home_small_timer = ctk.CTkLabel(small_f, text="--:--",
                                             font=ctk.CTkFont(size=22, weight="bold"),
                                             text_color=C_BLUE)
        self.home_small_timer.pack(pady=(0, 8))

        big_f = ctk.CTkFrame(timers, fg_color="#162030", corner_radius=10)
        big_f.pack(side="left", expand=True, fill="x", padx=(4, 0))
        ctk.CTkLabel(big_f, text=t("home.big_break"), font=ctk.CTkFont(size=11),
                     text_color=C_TEXT_DIM).pack(pady=(8, 0))
        self.home_big_timer = ctk.CTkLabel(big_f, text="--:--",
                                           font=ctk.CTkFont(size=22, weight="bold"),
                                           text_color=C_ORANGE)
        self.home_big_timer.pack(pady=(0, 8))

        # --- Water card ---
        card = self._card(main)
        water_row = ctk.CTkFrame(card, fg_color="transparent")
        water_row.pack(fill="x", padx=18, pady=14)

        water_left = ctk.CTkFrame(water_row, fg_color="transparent")
        water_left.pack(side="left", fill="x", expand=True)
        ctk.CTkLabel(water_left, text=f"\U0001f4a7  {t('home.water')}",
                     font=ctk.CTkFont(size=13)).pack(anchor="w")

        self.home_water_dots = ctk.CTkFrame(water_left, fg_color="transparent")
        self.home_water_dots.pack(anchor="w", pady=3)

        self.home_water_text = ctk.CTkLabel(water_left, text="",
                                            font=ctk.CTkFont(size=12), text_color=C_TEXT_DIM)
        self.home_water_text.pack(anchor="w")

        ctk.CTkButton(
            water_row, text="\U0001f4a7 +1", width=70, height=36,
            corner_radius=10, fg_color=C_BLUE, hover_color="#2980b9",
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self._log_water,
        ).pack(side="right")

        # --- Music card (compact) ---
        card = self._card(main)
        music_row = ctk.CTkFrame(card, fg_color="transparent")
        music_row.pack(fill="x", padx=18, pady=14)

        music_left = ctk.CTkFrame(music_row, fg_color="transparent")
        music_left.pack(side="left", fill="x", expand=True)
        ctk.CTkLabel(music_left, text=f"\U0001f3b5  {t('home.sound')}",
                     font=ctk.CTkFont(size=13)).pack(anchor="w")
        self.home_music_status = ctk.CTkLabel(music_left, text=t("home.sound_off"),
                                              font=ctk.CTkFont(size=12), text_color=C_TEXT_DIM)
        self.home_music_status.pack(anchor="w")

        music_btns = ctk.CTkFrame(music_row, fg_color="transparent")
        music_btns.pack(side="right")

        self.home_music_toggle = ctk.CTkButton(
            music_btns, text="\u23f9", width=36, height=36,
            corner_radius=18, fg_color=C_RED, hover_color="#c0392b",
            font=ctk.CTkFont(size=14),
            command=self._home_toggle_music,
        )
        self.home_music_toggle.pack(side="left", padx=(0, 5))

        ctk.CTkButton(
            music_btns, text="\u266b", width=36, height=36,
            corner_radius=18, fg_color=C_BTN_DARK, hover_color=C_BTN_DARK_HOVER,
            font=ctk.CTkFont(size=14),
            command=lambda: self._show_page("music"),
        ).pack(side="left")

        return page

    # =========================================================================
    #  STATS PAGE
    # =========================================================================
    def _build_stats_page(self) -> ctk.CTkFrame:
        page = ctk.CTkFrame(self.content, fg_color="transparent")

        ctk.CTkLabel(page, text=f"\U0001f4ca  {t('stats.title')}",
                     font=ctk.CTkFont(size=20, weight="bold")).pack(
            anchor="w", padx=20, pady=(12, 4))

        self.stats_tabview = ctk.CTkTabview(page, corner_radius=10)
        self.stats_tabview.pack(fill="both", expand=True, padx=15, pady=(0, 10))

        self.stats_tab_today = self.stats_tabview.add(t("stats.today"))
        self.stats_tab_week = self.stats_tabview.add(t("stats.week"))

        # Container frames for dynamic rebuild
        self.stats_today_container = ctk.CTkFrame(self.stats_tab_today, fg_color="transparent")
        self.stats_today_container.pack(fill="both", expand=True)

        self.stats_week_container = ctk.CTkFrame(self.stats_tab_week, fg_color="transparent")
        self.stats_week_container.pack(fill="both", expand=True)

        return page

    def _refresh_stats(self):
        # Clear and rebuild today tab
        for w in self.stats_today_container.winfo_children():
            w.destroy()
        self._build_stats_today(self.stats_today_container)

        # Clear and rebuild week tab
        for w in self.stats_week_container.winfo_children():
            w.destroy()
        self._build_stats_week(self.stats_week_container)

    def _build_stats_today(self, parent):
        frame = ctk.CTkScrollableFrame(parent, fg_color="transparent")
        frame.pack(fill="both", expand=True)

        # Summary row
        summary_row = ctk.CTkFrame(frame, fg_color="transparent")
        summary_row.pack(fill="x", pady=(5, 5), padx=5)

        total_sec = database.get_total_time_today()
        self._summary_card(summary_row, "\U0001f5a5", t("stats.work_time"), _fmt_dur(total_sec), C_ACCENT)

        breaks = database.get_breaks_today()
        taken = sum(1 for b in breaks if not b["skipped"])
        skipped = sum(1 for b in breaks if b["skipped"])
        self._summary_card(summary_row, "\u23f8", t("stats.breaks"), f"{taken} \u2713  {skipped} \u2717", C_BLUE)

        water = database.get_water_today()
        goal = self.app.config.get("water_daily_goal", 8)
        self._summary_card(summary_row, "\U0001f4a7", t("stats.water"), f"{water} / {goal}", C_BLUE)

        # Water progress
        water_card = self._card(frame)
        ctk.CTkLabel(water_card, text=t("stats.hydration"),
                     font=ctk.CTkFont(size=14, weight="bold")).pack(anchor="w", padx=15, pady=(12, 5))

        progress_frame = ctk.CTkFrame(water_card, fg_color="transparent")
        progress_frame.pack(fill="x", padx=15, pady=(0, 12))

        for i in range(goal):
            color = C_BLUE if i < water else C_BTN_DARK
            ctk.CTkLabel(progress_frame, text="\u25cf", font=ctk.CTkFont(size=16),
                         text_color=color).pack(side="left", padx=2)

        pct = min(water / max(goal, 1), 1.0)
        ctk.CTkLabel(progress_frame, text=f"  {int(pct*100)}%",
                     font=ctk.CTkFont(size=13, weight="bold"),
                     text_color=C_BLUE).pack(side="left", padx=(10, 0))

        # Top apps
        activity = database.get_activity_today()
        if activity:
            apps_card = self._card(frame)
            ctk.CTkLabel(apps_card, text=t("stats.top_apps"),
                         font=ctk.CTkFont(size=14, weight="bold")).pack(
                anchor="w", padx=15, pady=(12, 5))

            for i, app in enumerate(activity[:7]):
                name = app["process_name"]
                cat = app.get("category", "Inne")
                dur = _fmt_dur(app["total_sec"])
                color = STAT_COLORS.get(cat, "#95a5a6")

                row = ctk.CTkFrame(apps_card, fg_color="transparent")
                row.pack(fill="x", padx=15, pady=2)

                ctk.CTkLabel(row, text=f"{i+1}.", font=ctk.CTkFont(size=12),
                             text_color="#555d6b", width=25).pack(side="left")
                ctk.CTkLabel(row, text=name, font=ctk.CTkFont(size=13),
                             anchor="w", width=180).pack(side="left")

                badge = ctk.CTkFrame(row, corner_radius=8, fg_color=color, width=85, height=22)
                badge.pack(side="left", padx=5)
                badge.pack_propagate(False)
                ctk.CTkLabel(badge, text=cat, font=ctk.CTkFont(size=10),
                             text_color="white").pack(expand=True)

                ctk.CTkLabel(row, text=dur, font=ctk.CTkFont(size=13, weight="bold"),
                             anchor="e").pack(side="right")

            ctk.CTkFrame(apps_card, fg_color="transparent", height=8).pack()

        # Category pie chart
        categories = database.get_category_summary_today()
        if categories:
            cat_card = self._card(frame)
            ctk.CTkLabel(cat_card, text=t("stats.categories"),
                         font=ctk.CTkFont(size=14, weight="bold")).pack(
                anchor="w", padx=15, pady=(12, 5))
            self._draw_pie_chart(cat_card, categories)
            ctk.CTkFrame(cat_card, fg_color="transparent", height=8).pack()

    def _summary_card(self, parent, icon: str, label: str, value: str, color: str):
        card = ctk.CTkFrame(parent, corner_radius=12, fg_color=C_CARD, width=200, height=90)
        card.pack(side="left", expand=True, fill="both", padx=3, pady=3)
        card.pack_propagate(False)

        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(expand=True)

        header_row = ctk.CTkFrame(inner, fg_color="transparent")
        header_row.pack()
        ctk.CTkLabel(header_row, text=icon, font=ctk.CTkFont(size=16)).pack(side="left", padx=(0, 5))
        ctk.CTkLabel(header_row, text=label, font=ctk.CTkFont(size=12),
                     text_color=C_TEXT_DIM).pack(side="left")
        ctk.CTkLabel(inner, text=value, font=ctk.CTkFont(size=18, weight="bold"),
                     text_color=color).pack()

    def _draw_pie_chart(self, parent, categories: dict):
        canvas_frame = ctk.CTkFrame(parent, fg_color="transparent")
        canvas_frame.pack(pady=5, padx=15)

        canvas = tk.Canvas(canvas_frame, width=380, height=180, bg=C_CARD,
                           highlightthickness=0)
        canvas.pack(side="left")

        total = sum(categories.values())
        if total == 0:
            return

        start = 0
        cx, cy, r = 90, 90, 75
        for cat, sec in sorted(categories.items(), key=lambda x: -x[1]):
            extent = (sec / total) * 360
            color = STAT_COLORS.get(cat, "#95a5a6")
            canvas.create_arc(cx - r, cy - r, cx + r, cy + r,
                              start=start, extent=extent,
                              fill=color, outline=C_CARD, width=2)
            start += extent

        legend_x, legend_y = 195, 15
        for cat, sec in sorted(categories.items(), key=lambda x: -x[1]):
            color = STAT_COLORS.get(cat, "#95a5a6")
            canvas.create_rectangle(legend_x, legend_y, legend_x + 14, legend_y + 14,
                                    fill=color, outline=color)
            pct = int((sec / total) * 100)
            dur = _fmt_dur(sec)
            canvas.create_text(legend_x + 20, legend_y + 7, anchor="w",
                               text=f"{cat}  {pct}%  ({dur})", fill="#c8ccd0",
                               font=("Segoe UI", 10))
            legend_y += 26

    def _build_stats_week(self, parent):
        frame = ctk.CTkScrollableFrame(parent, fg_color="transparent")
        frame.pack(fill="both", expand=True)

        from datetime import date, timedelta

        # Bar chart
        chart_card = self._card(frame)
        ctk.CTkLabel(chart_card, text=t("stats.work_time_7days"),
                     font=ctk.CTkFont(size=14, weight="bold")).pack(anchor="w", padx=15, pady=(12, 5))

        daily = database.get_weekly_daily_totals()
        self._draw_bar_chart(chart_card, daily)
        ctk.CTkFrame(chart_card, fg_color="transparent", height=8).pack()

        # Breaks table
        breaks = database.get_weekly_breaks()
        if breaks:
            breaks_card = self._card(frame)
            ctk.CTkLabel(breaks_card, text=t("stats.breaks_7days"),
                         font=ctk.CTkFont(size=14, weight="bold")).pack(
                anchor="w", padx=15, pady=(12, 5))

            for b in breaks:
                row = ctk.CTkFrame(breaks_card, fg_color="transparent")
                row.pack(fill="x", padx=15, pady=2)

                ctk.CTkLabel(row, text=b["day"], font=ctk.CTkFont(size=12),
                             text_color=C_TEXT_DIM, width=90).pack(side="left")

                taken = b["count"] - b["skipped_count"]
                ctk.CTkLabel(row, text=f"\u2713 {taken}",
                             font=ctk.CTkFont(size=12, weight="bold"),
                             text_color=C_ACCENT, width=50).pack(side="left", padx=5)
                ctk.CTkLabel(row, text=f"\u2717 {b['skipped_count']}",
                             font=ctk.CTkFont(size=12, weight="bold"),
                             text_color=C_RED, width=50).pack(side="left")

            ctk.CTkFrame(breaks_card, fg_color="transparent", height=10).pack()

    def _draw_bar_chart(self, parent, daily_data: list[dict]):
        from datetime import date, timedelta

        canvas_frame = ctk.CTkFrame(parent, fg_color="transparent")
        canvas_frame.pack(pady=5, padx=15, fill="x")

        canvas = tk.Canvas(canvas_frame, width=560, height=200, bg=C_CARD,
                           highlightthickness=0)
        canvas.pack()

        today = date.today()
        week = {}
        for i in range(6, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            week[d] = 0
        for entry in daily_data:
            if entry["day"] in week:
                week[entry["day"]] = entry["total_sec"]

        days = list(week.keys())
        values = list(week.values())

        if not any(values):
            canvas.create_text(280, 100, text=t("stats.no_data_week"),
                               fill="#555d6b", font=("Segoe UI", 13))
            return

        max_val = max(values) if max(values) > 0 else 1
        bar_w = 55
        gap = 16
        chart_h = 140
        base_y = 170
        start_x = 30

        for i, (day, val) in enumerate(zip(days, values)):
            x = start_x + i * (bar_w + gap)
            h = (val / max_val) * chart_h if max_val > 0 else 0

            if h > 4:
                canvas.create_rectangle(x, base_y - h + 3, x + bar_w, base_y,
                                        fill=C_ACCENT, outline="")
                canvas.create_oval(x, base_y - h, x + bar_w, base_y - h + 6,
                                   fill=C_ACCENT, outline="")
            elif h > 0:
                canvas.create_rectangle(x, base_y - h, x + bar_w, base_y,
                                        fill=C_ACCENT, outline="")

            short_day = day[5:]
            canvas.create_text(x + bar_w // 2, base_y + 15, text=short_day,
                               fill=C_TEXT_DIM, font=("Segoe UI", 9))

            if val > 0:
                canvas.create_text(x + bar_w // 2, base_y - h - 12,
                                   text=_fmt_dur(val), fill="#c8ccd0",
                                   font=("Segoe UI", 9))

    # =========================================================================
    #  MUSIC PAGE
    # =========================================================================
    def _build_music_page(self) -> ctk.CTkFrame:
        page = ctk.CTkFrame(self.content, fg_color="transparent")

        # Scrollable container for everything
        main = ctk.CTkScrollableFrame(page, fg_color="transparent")
        main.pack(fill="both", expand=True, padx=10, pady=(0, 5))

        # ---- Native sounds section ----
        header = ctk.CTkFrame(main, fg_color="transparent")
        header.pack(pady=(8, 3), padx=10, anchor="w")
        ctk.CTkLabel(header, text="\U0001f3b5", font=ctk.CTkFont(size=20)).pack(side="left", padx=(0, 8))
        ctk.CTkLabel(header, text=t("music.focus_sounds"),
                     font=ctk.CTkFont(size=20, weight="bold")).pack(side="left")

        ctk.CTkLabel(main, text=t("music.native_desc"),
                     font=ctk.CTkFont(size=12), text_color=C_TEXT_DIM).pack(padx=10, anchor="w", pady=(0, 5))

        # Volume
        vol_frame = ctk.CTkFrame(main, fg_color="transparent")
        vol_frame.pack(fill="x", padx=10, pady=(0, 8))

        ctk.CTkLabel(vol_frame, text=t("music.volume"), font=ctk.CTkFont(size=12)).pack(side="left")
        self.music_vol_label = ctk.CTkLabel(vol_frame, text=f"{int(audio_engine.get_volume()*100)}%",
                                            font=ctk.CTkFont(size=12, weight="bold"),
                                            text_color=C_ACCENT, width=40)
        self.music_vol_label.pack(side="right")

        self.music_vol_slider = ctk.CTkSlider(
            vol_frame, from_=0, to=100, number_of_steps=20,
            height=14, corner_radius=7,
            button_color=C_ACCENT, button_hover_color=C_ACCENT_HOVER,
            progress_color=C_ACCENT,
            command=self._on_music_volume,
        )
        self.music_vol_slider.set(audio_engine.get_volume() * 100)
        self.music_vol_slider.pack(side="right", padx=8, expand=True, fill="x")

        # Sound cards
        current = audio_engine.get_current()

        for key, info in audio_engine.SOUND_TYPES.items():
            is_active = (key == current and audio_engine.is_playing())
            card = ctk.CTkFrame(main, corner_radius=12,
                                fg_color="#1a2332" if is_active else C_CARD)
            card.pack(fill="x", pady=3)

            inner = ctk.CTkFrame(card, fg_color="transparent")
            inner.pack(fill="x", padx=12, pady=10)

            text_frame = ctk.CTkFrame(inner, fg_color="transparent")
            text_frame.pack(side="left", fill="x", expand=True)

            name_row = ctk.CTkFrame(text_frame, fg_color="transparent")
            name_row.pack(anchor="w")
            ctk.CTkLabel(name_row, text=info["icon"],
                         font=ctk.CTkFont(size=18)).pack(side="left", padx=(0, 8))
            ctk.CTkLabel(name_row, text=info["name"],
                         font=ctk.CTkFont(size=14, weight="bold")).pack(side="left")

            ctk.CTkLabel(text_frame, text=info["desc"],
                         font=ctk.CTkFont(size=11), text_color=C_TEXT_DIM).pack(anchor="w", padx=28)

            if is_active:
                btn_text, btn_color, btn_hover = "\u23f9", C_RED, "#c0392b"
            else:
                btn_text, btn_color, btn_hover = "\u25b6", C_ACCENT, C_ACCENT_HOVER

            btn = ctk.CTkButton(
                inner, text=btn_text, width=42, height=42,
                corner_radius=21, fg_color=btn_color, hover_color=btn_hover,
                font=ctk.CTkFont(size=16),
                command=lambda k=key: self._toggle_sound(k),
            )
            btn.pack(side="right")
            self._music_btns[key] = btn

        # ---- YouTube Radio section ----
        sep = ctk.CTkFrame(main, fg_color="#333", height=1)
        sep.pack(fill="x", padx=10, pady=(15, 5))

        yt_header = ctk.CTkFrame(main, fg_color="transparent")
        yt_header.pack(pady=(5, 3), padx=10, anchor="w")
        ctk.CTkLabel(yt_header, text="\U0001f4fb", font=ctk.CTkFont(size=20)).pack(side="left", padx=(0, 8))
        ctk.CTkLabel(yt_header, text="YouTube Radio",
                     font=ctk.CTkFont(size=20, weight="bold")).pack(side="left")

        if not self._yt_available:
            warn_card = self._card(main)
            ctk.CTkLabel(warn_card, text=f"\u26a0  {t('music.yt_requires')}",
                         font=ctk.CTkFont(size=12), text_color=C_ORANGE,
                         wraplength=500).pack(padx=15, pady=12)
            ctk.CTkLabel(warn_card, text=t("music.yt_install_hint"),
                         font=ctk.CTkFont(size=11), text_color=C_TEXT_DIM,
                         wraplength=500).pack(padx=15, pady=(0, 12))
        else:
            ctk.CTkLabel(main, text=t("music.yt_desc"),
                         font=ctk.CTkFont(size=12), text_color=C_TEXT_DIM).pack(padx=10, anchor="w", pady=(0, 5))

            # Status label for YouTube playback
            self._yt_status_label = ctk.CTkLabel(main, text="", font=ctk.CTkFont(size=11),
                                                  text_color=C_ACCENT)
            self._yt_status_label.pack(padx=10, anchor="w")

            # Station cards
            for key, info in yt_player.STATIONS.items():
                yt_current = yt_player.get_current()
                is_active = (key == yt_current)
                card = ctk.CTkFrame(main, corner_radius=12,
                                    fg_color="#1a2332" if is_active else C_CARD)
                card.pack(fill="x", pady=3)

                inner = ctk.CTkFrame(card, fg_color="transparent")
                inner.pack(fill="x", padx=12, pady=10)

                text_frame = ctk.CTkFrame(inner, fg_color="transparent")
                text_frame.pack(side="left", fill="x", expand=True)

                name_row = ctk.CTkFrame(text_frame, fg_color="transparent")
                name_row.pack(anchor="w")
                ctk.CTkLabel(name_row, text=info["icon"],
                             font=ctk.CTkFont(size=18)).pack(side="left", padx=(0, 8))
                ctk.CTkLabel(name_row, text=info["name"],
                             font=ctk.CTkFont(size=14, weight="bold")).pack(side="left")

                ctk.CTkLabel(text_frame, text=info["desc"],
                             font=ctk.CTkFont(size=11), text_color=C_TEXT_DIM).pack(anchor="w", padx=28)

                if is_active:
                    btn_text, btn_color, btn_hover = "\u23f9", C_RED, "#c0392b"
                else:
                    btn_text, btn_color, btn_hover = "\u25b6", "#9b59b6", "#8e44ad"

                btn = ctk.CTkButton(
                    inner, text=btn_text, width=42, height=42,
                    corner_radius=21, fg_color=btn_color, hover_color=btn_hover,
                    font=ctk.CTkFont(size=16),
                    command=lambda k=key: self._toggle_yt_station(k),
                )
                btn.pack(side="right")
                self._yt_btns[key] = btn

            # Custom URL input
            custom_card = self._card(main)
            ctk.CTkLabel(custom_card, text=t("music.custom_link_label"),
                         font=ctk.CTkFont(size=12)).pack(anchor="w", padx=15, pady=(12, 4))

            url_frame = ctk.CTkFrame(custom_card, fg_color="transparent")
            url_frame.pack(fill="x", padx=15, pady=(0, 12))

            self._yt_custom_entry = ctk.CTkEntry(url_frame, height=36, corner_radius=8,
                                                  placeholder_text="https://www.youtube.com/watch?v=...")
            self._yt_custom_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

            ctk.CTkButton(
                url_frame, text=f"\U0001f50d {t('music.search')}", width=90, height=36,
                corner_radius=8, fg_color=C_BTN_DARK, hover_color=C_BTN_DARK_HOVER,
                font=ctk.CTkFont(size=13, weight="bold"),
                command=self._open_yt_search,
            ).pack(side="right", padx=(0, 5))

            ctk.CTkButton(
                url_frame, text=f"\u25b6 {t('music.play')}", width=80, height=36,
                corner_radius=8, fg_color="#9b59b6", hover_color="#8e44ad",
                font=ctk.CTkFont(size=13, weight="bold"),
                command=self._play_custom_yt,
            ).pack(side="right")

        # ---- Stop all button ----
        ctk.CTkButton(
            main, text=f"\u23f9  {t('music.stop_all')}", command=self._stop_all_music,
            fg_color="transparent", hover_color="#3a3a4a",
            border_width=1, border_color="#555555",
            height=36, corner_radius=10, width=180,
            text_color="#999999",
        ).pack(pady=10)

        return page

    # =========================================================================
    #  SETTINGS PAGE
    # =========================================================================
    def _build_settings_page(self) -> ctk.CTkFrame:
        page = ctk.CTkFrame(self.content, fg_color="transparent")

        ctk.CTkLabel(page, text=f"\u2699  {t('settings.title')}",
                     font=ctk.CTkFont(size=20, weight="bold")).pack(
            anchor="w", padx=20, pady=(12, 4))

        main = ctk.CTkScrollableFrame(page, fg_color="transparent")
        main.pack(fill="both", expand=True, padx=15, pady=(0, 5))

        cfg = self.app.config
        from config import WORK_METHODS

        # --- Work method ---
        self._section_header(main, f"\U0001f4cb  {t('settings.work_method')}")
        method_card = self._card(main)

        self._method_keys = ["pomodoro", "20-20-20", "52-17", "90-min", "custom"]
        method_names = [
            t("settings.method_pomodoro"),
            t("settings.method_20_20_20"),
            t("settings.method_52_17"),
            t("settings.method_90_min"),
            t("settings.method_custom"),
        ]
        self._method_name_to_key = dict(zip(method_names, self._method_keys))
        current_method = cfg.get("work_method", "pomodoro")
        current_method_name = method_names[self._method_keys.index(current_method)] if current_method in self._method_keys else method_names[-1]

        method_row = ctk.CTkFrame(method_card, fg_color="transparent")
        method_row.pack(fill="x", padx=15, pady=(12, 2))

        self.set_work_method = ctk.CTkOptionMenu(
            method_row, values=method_names, width=200, height=34,
            font=ctk.CTkFont(size=13),
            fg_color=C_BTN_DARK, button_color=C_BTN_DARK_HOVER,
            dropdown_fg_color=C_CARD,
            command=self._on_method_changed,
        )
        self.set_work_method.set(current_method_name)
        self.set_work_method.pack(side="left")

        self._method_desc_label = ctk.CTkLabel(
            method_card, text=self._get_method_desc(current_method),
            font=ctk.CTkFont(size=11), text_color=C_TEXT_DIM,
            wraplength=500, justify="left",
        )
        self._method_desc_label.pack(anchor="w", padx=15, pady=(2, 12))

        # --- Breaks ---
        self._section_header(main, f"\u23f8  {t('settings.breaks_section')}")
        card = self._card(main)
        self.set_small_interval = self._add_slider(card, t("settings.small_break_every"), t("settings.unit_min"),
                                                   1, 120, cfg["small_break_interval_min"])
        self.set_small_duration = self._add_slider(card, t("settings.small_break_duration"), t("settings.unit_sec"),
                                                   10, 1200, cfg["small_break_duration_sec"])
        self.set_big_interval = self._add_slider(card, t("settings.big_break_every"), t("settings.unit_min"),
                                                 15, 300, cfg["big_break_interval_min"])
        self.set_big_duration = self._add_slider(card, t("settings.big_break_duration"), t("settings.unit_min"),
                                                 1, 30, cfg["big_break_duration_min"])

        mode_label = ctk.CTkLabel(card, text=t("settings.break_mode"), font=ctk.CTkFont(size=13))
        mode_label.pack(anchor="w", padx=15, pady=(10, 2))

        self.set_break_mode = ctk.StringVar(value=cfg["break_mode"])
        mode_frame = ctk.CTkFrame(card, fg_color="transparent")
        mode_frame.pack(anchor="w", padx=15, pady=(0, 10))

        ctk.CTkRadioButton(
            mode_frame, text=t("settings.mode_moderate"), variable=self.set_break_mode,
            value="moderate", font=ctk.CTkFont(size=12)).pack(side="left", padx=(0, 20))
        ctk.CTkRadioButton(
            mode_frame, text=t("settings.mode_aggressive"), variable=self.set_break_mode,
            value="aggressive", font=ctk.CTkFont(size=12)).pack(side="left")

        # --- Water ---
        self._section_header(main, f"\U0001f4a7  {t('settings.hydration_section')}")
        card = self._card(main)
        self.set_water_interval = self._add_slider(card, t("settings.reminder_every"), t("settings.unit_min"),
                                                   10, 120, cfg["water_interval_min"])
        self.set_water_goal = self._add_slider(card, t("settings.daily_goal"), t("settings.unit_glasses"),
                                               1, 20, cfg["water_daily_goal"])

        # --- Eyes ---
        self._section_header(main, f"\U0001f441  {t('settings.eye_section')}")
        card = self._card(main)
        self.set_eye_interval = self._add_slider(card, t("settings.reminder_every"), t("settings.unit_min"),
                                                 10, 120, cfg["eye_exercise_interval_min"])

        # --- Work hours ---
        self._section_header(main, f"\U0001f550  {t('settings.work_hours_section')}")
        card = self._card(main)
        self.set_work_hours_enabled = ctk.BooleanVar(value=cfg.get("work_hours_enabled", False))
        ctk.CTkCheckBox(card, text=t("settings.work_hours_only"),
                        variable=self.set_work_hours_enabled,
                        font=ctk.CTkFont(size=13)).pack(anchor="w", padx=15, pady=(12, 5))

        hours_frame = ctk.CTkFrame(card, fg_color="transparent")
        hours_frame.pack(anchor="w", padx=15, pady=(0, 12))
        ctk.CTkLabel(hours_frame, text=t("settings.from_hour"), font=ctk.CTkFont(size=13)).pack(side="left")
        self.set_work_start = ctk.CTkEntry(hours_frame, width=65, height=32, corner_radius=8)
        self.set_work_start.insert(0, cfg.get("work_hours_start", "08:00"))
        self.set_work_start.pack(side="left", padx=(5, 15))
        ctk.CTkLabel(hours_frame, text=t("settings.to_hour"), font=ctk.CTkFont(size=13)).pack(side="left")
        self.set_work_end = ctk.CTkEntry(hours_frame, width=65, height=32, corner_radius=8)
        self.set_work_end.insert(0, cfg.get("work_hours_end", "18:00"))
        self.set_work_end.pack(side="left", padx=5)

        # --- Dzwiek ---
        self._section_header(main, f"\U0001f514  {t('settings.sound_section')}")
        card = self._card(main)
        self.set_sound_notifications = ctk.BooleanVar(value=cfg.get("sound_notifications", True))
        ctk.CTkCheckBox(card, text=t("settings.sound_on_break"),
                        variable=self.set_sound_notifications,
                        font=ctk.CTkFont(size=13)).pack(anchor="w", padx=15, pady=12)

        # --- Prywatnosc ---
        self._section_header(main, f"\U0001f512  {t('settings.privacy_section')}")
        card = self._card(main)
        self.set_telemetry_enabled = ctk.BooleanVar(value=cfg.get("telemetry_enabled", True))
        ctk.CTkCheckBox(card, text=t("settings.telemetry"),
                        variable=self.set_telemetry_enabled,
                        font=ctk.CTkFont(size=13)).pack(anchor="w", padx=15, pady=(12, 2))
        ctk.CTkLabel(card, text=t("settings.telemetry_desc"),
                     font=ctk.CTkFont(size=11), text_color=C_TEXT_DIM).pack(anchor="w", padx=35, pady=(0, 8))

        self.set_track_titles = ctk.BooleanVar(value=cfg.get("track_window_titles", False))
        ctk.CTkCheckBox(card, text=t("settings.track_titles"),
                        variable=self.set_track_titles,
                        font=ctk.CTkFont(size=13)).pack(anchor="w", padx=15, pady=(4, 2))
        ctk.CTkLabel(card, text=t("settings.track_titles_desc"),
                     font=ctk.CTkFont(size=11), text_color=C_TEXT_DIM).pack(anchor="w", padx=35, pady=(0, 12))

        # --- System ---
        self._section_header(main, f"\U0001f5a5  {t('settings.system_section')}")
        card = self._card(main)

        # Language selector
        lang_frame = ctk.CTkFrame(card, fg_color="transparent")
        lang_frame.pack(fill="x", padx=15, pady=(12, 5))
        ctk.CTkLabel(lang_frame, text=t("settings.language"), font=ctk.CTkFont(size=13)).pack(side="left")

        import i18n as _i18n
        available = _i18n.get_available_languages()
        lang_names = [l["name"] for l in available]
        self._lang_codes = [l["code"] for l in available]
        current_lang = cfg.get("language", "pl")
        current_name = next((l["name"] for l in available if l["code"] == current_lang), "Polski")

        self.set_language = ctk.CTkOptionMenu(
            lang_frame, values=lang_names, width=150, height=32,
            font=ctk.CTkFont(size=12),
            command=self._on_language_changed,
        )
        self.set_language.set(current_name)
        self.set_language.pack(side="right")

        self._lang_restart_label = ctk.CTkLabel(card, text="", font=ctk.CTkFont(size=11),
                                                 text_color=C_ORANGE)
        self._lang_restart_label.pack(anchor="w", padx=15, pady=(0, 5))

        self.set_autostart = ctk.BooleanVar(value=cfg.get("autostart", False))
        ctk.CTkCheckBox(card, text=t("settings.autostart"),
                        variable=self.set_autostart,
                        font=ctk.CTkFont(size=13)).pack(anchor="w", padx=15, pady=12)

        self.set_auto_update = ctk.BooleanVar(value=cfg.get("auto_update", True))
        ctk.CTkCheckBox(card, text=t("settings.auto_update"),
                        variable=self.set_auto_update,
                        font=ctk.CTkFont(size=13)).pack(anchor="w", padx=15, pady=(0, 8))

        ctk.CTkButton(
            card, text=t("settings.check_now"), width=160, height=32,
            fg_color="transparent", hover_color="#333355",
            border_width=1, border_color=C_ACCENT,
            text_color=C_ACCENT,
            font=ctk.CTkFont(size=12),
            command=self._on_check_updates,
        ).pack(anchor="w", padx=15, pady=(0, 12))

        # Save / Cancel
        btn_frame = ctk.CTkFrame(page, fg_color="transparent")
        btn_frame.pack(fill="x", padx=15, pady=10)

        ctk.CTkButton(
            btn_frame, text=t("settings.save"), command=self._save_settings,
            fg_color=C_ACCENT, hover_color=C_ACCENT_HOVER,
            height=42, corner_radius=10,
            font=ctk.CTkFont(size=14, weight="bold"),
        ).pack(side="left", expand=True, fill="x", padx=(0, 5))

        self.settings_status = ctk.CTkLabel(btn_frame, text="", font=ctk.CTkFont(size=12),
                                            text_color=C_ACCENT)
        self.settings_status.pack(side="right", padx=10)

        return page

    def _section_header(self, parent, text: str):
        ctk.CTkLabel(parent, text=text, font=ctk.CTkFont(size=15, weight="bold")).pack(
            anchor="w", pady=(15, 3), padx=5)

    def _add_slider(self, parent, label: str, unit: str, from_: int, to: int, default: int) -> ctk.CTkSlider:
        frame = ctk.CTkFrame(parent, fg_color="transparent")
        frame.pack(fill="x", padx=15, pady=6)

        ctk.CTkLabel(frame, text=label, font=ctk.CTkFont(size=13)).pack(side="left")

        val_label = ctk.CTkLabel(frame, text=f"{default} {unit}",
                                 font=ctk.CTkFont(size=13, weight="bold"),
                                 text_color=C_ACCENT, width=70)
        val_label.pack(side="right")

        slider = ctk.CTkSlider(
            frame, from_=from_, to=to, number_of_steps=to - from_,
            height=16, corner_radius=8,
            button_color=C_ACCENT, button_hover_color=C_ACCENT_HOVER,
            progress_color=C_ACCENT,
            command=lambda v, lbl=val_label, u=unit: lbl.configure(text=f"{int(v)} {u}"),
        )
        slider.set(default)
        slider.pack(side="right", padx=8, expand=True, fill="x")
        slider._hd_val_label = val_label
        slider._hd_unit = unit
        return slider

    def _get_method_desc(self, method_key: str) -> str:
        desc_map = {
            "pomodoro": "settings.method_pomodoro_desc",
            "20-20-20": "settings.method_20_20_20_desc",
            "52-17": "settings.method_52_17_desc",
            "90-min": "settings.method_90_min_desc",
            "custom": "settings.method_custom_desc",
        }
        return t(desc_map.get(method_key, "settings.method_custom_desc"))

    def _on_method_changed(self, value):
        from config import WORK_METHODS
        method_key = self._method_name_to_key.get(value, "custom")
        self._method_desc_label.configure(text=self._get_method_desc(method_key))

        if method_key in WORK_METHODS:
            preset = WORK_METHODS[method_key]
            self.set_small_interval.set(preset["small_break_interval_min"])
            self.set_small_duration.set(preset["small_break_duration_sec"])
            self.set_big_interval.set(preset["big_break_interval_min"])
            self.set_big_duration.set(preset["big_break_duration_min"])
            self.set_eye_interval.set(preset["eye_exercise_interval_min"])
            # Trigger label updates
            self._update_slider_label(self.set_small_interval, t("settings.unit_min"))
            self._update_slider_label(self.set_small_duration, t("settings.unit_sec"))
            self._update_slider_label(self.set_big_interval, t("settings.unit_min"))
            self._update_slider_label(self.set_big_duration, t("settings.unit_min"))
            self._update_slider_label(self.set_eye_interval, t("settings.unit_min"))

    def _update_slider_label(self, slider, unit: str):
        """Update the label next to a slider after programmatic change."""
        lbl = getattr(slider, "_hd_val_label", None)
        if lbl:
            lbl.configure(text=f"{int(slider.get())} {unit}")

    def _on_language_changed(self, value):
        self._lang_restart_label.configure(text=t("settings.language_restart"))

    def _on_check_updates(self):
        try:
            from updater import UpdateDialog
            UpdateDialog(self.app.root, self.app._on_quit)
        except Exception:
            pass

    def _save_settings(self):
        cfg = self.app.config
        # Save work method
        method_name = self.set_work_method.get()
        cfg["work_method"] = self._method_name_to_key.get(method_name, "custom")
        cfg["small_break_interval_min"] = int(self.set_small_interval.get())
        cfg["small_break_duration_sec"] = int(self.set_small_duration.get())
        cfg["big_break_interval_min"] = int(self.set_big_interval.get())
        cfg["big_break_duration_min"] = int(self.set_big_duration.get())
        cfg["break_mode"] = self.set_break_mode.get()
        cfg["water_interval_min"] = int(self.set_water_interval.get())
        cfg["water_daily_goal"] = int(self.set_water_goal.get())
        cfg["eye_exercise_interval_min"] = int(self.set_eye_interval.get())
        cfg["work_hours_enabled"] = self.set_work_hours_enabled.get()
        cfg["work_hours_start"] = self.set_work_start.get()
        cfg["work_hours_end"] = self.set_work_end.get()
        cfg["autostart"] = self.set_autostart.get()
        cfg["auto_update"] = self.set_auto_update.get()
        cfg["sound_notifications"] = self.set_sound_notifications.get()
        cfg["telemetry_enabled"] = self.set_telemetry_enabled.get()
        cfg["track_window_titles"] = self.set_track_titles.get()

        # Save language
        lang_name = self.set_language.get()
        try:
            import i18n as _i18n
            available = _i18n.get_available_languages()
            idx = [l["name"] for l in available].index(lang_name)
            cfg["language"] = available[idx]["code"]
        except (ValueError, IndexError):
            pass

        save_config(cfg)
        set_autostart(cfg["autostart"])

        self.app.config = cfg
        self.app.scheduler.update_config(cfg)

        self.settings_status.configure(text=f"\u2713 {t('settings.saved')}")
        self.after(2000, lambda: self.settings_status.configure(text=""))

    # =========================================================================
    #  HELP PAGE
    # =========================================================================
    def _build_help_page(self) -> ctk.CTkFrame:
        page = ctk.CTkFrame(self.content, fg_color="transparent")

        ctk.CTkLabel(page, text=f"\u2753  {t('help.title')}",
                     font=ctk.CTkFont(size=20, weight="bold")).pack(
            anchor="w", padx=20, pady=(12, 4))

        textbox = ctk.CTkTextbox(page, font=ctk.CTkFont(family="Consolas", size=13),
                                 wrap="word", activate_scrollbars=True)
        textbox.pack(fill="both", expand=True, padx=15, pady=(5, 10))
        textbox.insert("1.0", t("help.text"))
        textbox.configure(state="disabled")

        return page

    # =========================================================================
    #  HELPERS / CARD
    # =========================================================================
    def _card(self, parent) -> ctk.CTkFrame:
        card = ctk.CTkFrame(parent, corner_radius=14, fg_color=C_CARD)
        card.pack(fill="x", pady=3)
        return card

    # =========================================================================
    #  ACTIONS
    # =========================================================================
    def _quick_water(self):
        database.log_water(1)
        self._update_home_water()

    def _log_water(self):
        database.log_water(1)
        self._update_home_water()

    def _toggle_pause(self):
        sched = self.app.scheduler
        paused = not sched._paused
        sched.toggle_pause(paused)
        self.app.tray._paused = paused
        self._update_pause_ui()

    def _home_toggle_music(self):
        if audio_engine.is_playing() or yt_player.is_playing():
            audio_engine.stop()
            yt_player.stop()
            self._refresh_yt_buttons()
            self._set_yt_status("")

        else:
            # Resume last played sound
            cfg = self.app.config
            source = cfg.get("audio_last_source")
            audio_type = cfg.get("audio_last_type")
            if source == "youtube" and audio_type and self._yt_available:
                yt_player.stop()
                self._set_yt_status(t("music.connecting"))
                if audio_type in yt_player.STATIONS:
                    yt_player.play(
                        station_key=audio_type,
                        callback_started=lambda k: self._safe_after(self._on_yt_started, k),
                        callback_error=lambda e: self._safe_after(self._on_yt_error, e),
                    )
                else:
                    yt_player.play(
                        custom_url=audio_type,
                        callback_started=lambda k: self._safe_after(self._on_yt_started, k),
                        callback_error=lambda e: self._safe_after(self._on_yt_error, e),
                    )
            elif source == "native" and audio_type and audio_type in audio_engine.SOUND_TYPES:
                audio_engine.play(audio_type)
                self._save_audio_state("native", audio_type)
            else:
                audio_engine.play("brown_noise")
                self._save_audio_state("native", "brown_noise")
        self._update_home_music()
        self._refresh_music_buttons()

    def _open_yt_search(self):
        """Open YouTube search dialog."""
        YouTubeSearchDialog(self, self._on_yt_search_selected)

    def _on_yt_search_selected(self, url: str):
        """Callback when user picks a track from search results."""
        audio_engine.stop()
        self._refresh_music_buttons()
        yt_player.stop()
        self._set_yt_status(t("music.connecting"))
        yt_player.play(
            custom_url=url,
            callback_started=lambda k: self._safe_after(self._on_yt_started, k),
            callback_error=lambda e: self._safe_after(self._on_yt_error, e),
        )

    def _save_audio_state(self, source: str | None = None, audio_type: str | None = None):
        """Persist last audio selection to config for autoplay on next launch."""
        try:
            cfg = self.app.config
            cfg["audio_last_source"] = source
            cfg["audio_last_type"] = audio_type
            if source == "native":
                cfg["audio_last_volume"] = int(audio_engine.get_volume() * 100)
            elif source == "youtube":
                cfg["audio_last_volume"] = yt_player.get_volume()
            else:
                cfg["audio_last_volume"] = 10
            save_config(cfg)
        except Exception:
            pass

    def _toggle_sound(self, sound_key: str):
        if audio_engine.get_current() == sound_key and audio_engine.is_playing():
            audio_engine.stop()

        else:
            # Stop YouTube if playing
            yt_player.stop()
            self._refresh_yt_buttons()
            self._set_yt_status("")
            audio_engine.play(sound_key)
            self._save_audio_state("native", sound_key)
        self._refresh_music_buttons()
        self._update_home_music()

    def _toggle_yt_station(self, station_key: str):
        if yt_player.get_current() == station_key:
            yt_player.stop()

            self._refresh_yt_buttons()
            self._update_home_music()
        else:
            # Stop native audio if playing
            audio_engine.stop()
            self._refresh_music_buttons()
            # Stop other YT station
            yt_player.stop()
            self._set_yt_status(t("music.connecting"))
            yt_player.play(
                station_key=station_key,
                callback_started=lambda k: self._safe_after(self._on_yt_started, k),
                callback_error=lambda e: self._safe_after(self._on_yt_error, e),
            )

    def _play_custom_yt(self):
        url = self._yt_custom_entry.get().strip()
        if not url:
            return
        audio_engine.stop()
        self._refresh_music_buttons()
        yt_player.stop()
        self._set_yt_status(t("music.connecting"))
        yt_player.play(
            custom_url=url,
            callback_started=lambda k: self._safe_after(self._on_yt_started, k),
            callback_error=lambda e: self._safe_after(self._on_yt_error, e),
        )

    def _safe_after(self, func, *args):
        """Schedule func on main thread, ignore if window destroyed."""
        if self._destroyed:
            return
        try:
            self.after(0, func, *args)
        except Exception:
            pass

    def _on_yt_started(self, station_key):
        if self._destroyed:
            return
        try:
            name = t("music.custom_link_name")
            if station_key in yt_player.STATIONS:
                name = yt_player.STATIONS[station_key]["name"]
            self._set_yt_status(f"\u25b6 {t('music.playing', name=name)}")
            self._refresh_yt_buttons()
            self._update_home_music()
            self._save_audio_state("youtube", station_key)
        except Exception:
            pass

    def _on_yt_error(self, error_msg):
        if self._destroyed:
            return
        try:
            self._set_yt_status(f"\u26a0 {t('music.error', msg=error_msg)}")
            self._refresh_yt_buttons()
        except Exception:
            pass

    def _set_yt_status(self, text: str):
        if hasattr(self, "_yt_status_label") and not self._destroyed:
            try:
                self._yt_status_label.configure(text=text)
            except Exception:
                pass

    def _refresh_yt_buttons(self):
        if self._destroyed:
            return
        current = yt_player.get_current()
        for key, btn in self._yt_btns.items():
            try:
                if key == current and yt_player.is_playing():
                    btn.configure(text="\u23f9", fg_color=C_RED, hover_color="#c0392b")
                else:
                    btn.configure(text="\u25b6", fg_color="#9b59b6", hover_color="#8e44ad")
            except Exception:
                pass

    def _stop_all_music(self):
        audio_engine.stop()
        yt_player.stop()
        self._refresh_music_buttons()
        self._refresh_yt_buttons()
        self._update_home_music()
        self._set_yt_status("")

    def _refresh_music_buttons(self):
        current = audio_engine.get_current()
        for key, btn in self._music_btns.items():
            if key == current and audio_engine.is_playing():
                btn.configure(text="\u23f9", fg_color=C_RED, hover_color="#c0392b")
            else:
                btn.configure(text="\u25b6", fg_color=C_ACCENT, hover_color=C_ACCENT_HOVER)

    def _on_music_volume(self, val):
        v = int(val)
        audio_engine.set_volume(v / 100)
        yt_player.set_volume(v)
        self.music_vol_label.configure(text=f"{v}%")
        self.bottom_vol_slider.set(v)
        self.bottom_vol_label.configure(text=f"{v}%")

    def _on_bottom_volume(self, val):
        v = int(val)
        audio_engine.set_volume(v / 100)
        yt_player.set_volume(v)
        self.bottom_vol_label.configure(text=f"{v}%")
        self.music_vol_slider.set(v)
        self.music_vol_label.configure(text=f"{v}%")

    # =========================================================================
    #  LIVE UPDATE LOOP (1 sec)
    # =========================================================================
    def _update_loop(self):
        if self._destroyed:
            return
        try:
            self._update_home_data()
            self._update_bottom_bar()
            self._update_pause_ui()
        except Exception:
            pass
        self.after(1000, self._update_loop)

    def _update_home_data(self):
        if self._current_page != "home":
            return

        # Work time
        total = database.get_total_time_today()
        self.home_work_time.configure(text=_fmt_dur(total))

        # Breaks
        breaks = database.get_breaks_today()
        taken = sum(1 for b in breaks if not b["skipped"])
        skipped = sum(1 for b in breaks if b["skipped"])
        self.home_breaks.configure(text=f"\u2713{taken}  \u2717{skipped}")

        # Timers
        sched = self.app.scheduler
        if sched._paused:
            pause_text = f"\u23f8 {t('status.pause')}"
            if pause_text != self._last_small_text:
                self._last_small_text = pause_text
                self.home_small_timer.configure(text=pause_text, text_color=C_ORANGE)
            if pause_text != self._last_big_text:
                self._last_big_text = pause_text
                self.home_big_timer.configure(text=pause_text, text_color=C_ORANGE)
            return

        now = time.time()
        small_interval = self.app.config.get("small_break_interval_min", 20) * 60
        big_interval = self.app.config.get("big_break_interval_min", 60) * 60
        small_left = small_interval - (now - sched._last_small_break)
        big_left = big_interval - (now - sched._last_big_break)

        small_text = _fmt_countdown(small_left)
        if small_text != self._last_small_text:
            self._last_small_text = small_text
            self.home_small_timer.configure(text=small_text,
                                            text_color=C_RED if small_left < 60 else C_BLUE)

        big_text = _fmt_countdown(big_left)
        if big_text != self._last_big_text:
            self._last_big_text = big_text
            self.home_big_timer.configure(text=big_text,
                                          text_color=C_RED if big_left < 120 else C_ORANGE)

        # Water
        self._update_home_water()

        # Music
        self._update_home_music()

    def _update_home_water(self):
        current = database.get_water_today()
        goal = self.app.config.get("water_daily_goal", 8)

        if current != self._last_water_count:
            self._last_water_count = current
            for w in self.home_water_dots.winfo_children():
                w.destroy()
            for i in range(goal):
                color = C_BLUE if i < current else C_BTN_DARK
                ctk.CTkLabel(self.home_water_dots, text="\u25cf", font=ctk.CTkFont(size=14),
                             text_color=color).pack(side="left", padx=1)
            self.home_water_text.configure(text=t("home.glasses_count", current=current, goal=goal))

    def _update_home_music(self):
        current = audio_engine.get_current()
        yt_current = yt_player.get_current()
        if current and audio_engine.is_playing():
            info = audio_engine.SOUND_TYPES.get(current, {})
            name = info.get("name", current)
            icon = info.get("icon", "\U0001f3b5")
            self.home_music_status.configure(text=f"{icon} {name}", text_color=C_ACCENT)
            self.home_music_toggle.configure(text="\u23f9", fg_color=C_RED, hover_color="#c0392b")
        elif yt_current and yt_player.is_playing():
            info = yt_player.STATIONS.get(yt_current, {})
            name = info.get("name", "YouTube")
            icon = info.get("icon", "\U0001f4fb")
            self.home_music_status.configure(text=f"{icon} {name}", text_color="#9b59b6")
            self.home_music_toggle.configure(text="\u23f9", fg_color=C_RED, hover_color="#c0392b")
        else:
            self.home_music_status.configure(text=t("home.sound_off"), text_color=C_TEXT_DIM)
            self.home_music_toggle.configure(text="\u25b6", fg_color=C_ACCENT, hover_color=C_ACCENT_HOVER)

    def _update_bottom_bar(self):
        # Music info
        current = audio_engine.get_current()
        yt_current = yt_player.get_current()
        if current and audio_engine.is_playing():
            info = audio_engine.SOUND_TYPES.get(current, {})
            self.bottom_music_label.configure(
                text=f"{info.get('icon', '')} {info.get('name', current)}",
                text_color=C_ACCENT)
        elif yt_current and yt_player.is_playing():
            info = yt_player.STATIONS.get(yt_current, {})
            self.bottom_music_label.configure(
                text=f"{info.get('icon', '\U0001f4fb')} {info.get('name', 'YouTube')}",
                text_color="#9b59b6")
        else:
            self.bottom_music_label.configure(text="\U0001f3b5 --", text_color=C_TEXT_DIM)

        # Countdown to next break
        sched = self.app.scheduler
        now = time.time()
        small_interval = self.app.config.get("small_break_interval_min", 20) * 60
        big_interval = self.app.config.get("big_break_interval_min", 60) * 60
        small_left = small_interval - (now - sched._last_small_break)
        big_left = big_interval - (now - sched._last_big_break)

        next_left = min(small_left, big_left)
        if sched._paused:
            self.bottom_status.configure(text=f"\u23f8 {t('status.pause')}", text_color=C_ORANGE)
        elif next_left > 0:
            self.bottom_status.configure(
                text=f"\u23f1 {t('status.to_break', time=_fmt_countdown(next_left))}",
                text_color=C_TEXT_DIM)
        else:
            self.bottom_status.configure(text=f"\u23f1 {t('status.break_now')}", text_color=C_ACCENT)

    def _update_pause_ui(self):
        paused = self.app.scheduler._paused
        if paused:
            self.pause_sidebar_btn.configure(text=f"\u25b6  {t('nav.resume')}", text_color=C_ACCENT)
        else:
            self.pause_sidebar_btn.configure(text=f"\u23f8  {t('nav.pause')}", text_color=C_ORANGE)

    # =========================================================================
    #  CLOSE
    # =========================================================================
    def _close(self):
        self._destroyed = True
        self.destroy()
