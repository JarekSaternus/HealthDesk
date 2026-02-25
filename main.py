"""HealthDesk - Aplikacja do zdrowej pracy przy komputerze."""
import sys
import os
import threading
import ctypes

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _check_single_instance():
    """Prevent running multiple instances using a Windows named mutex."""
    mutex_name = "Global\\HealthDesk_SingleInstance_Mutex"
    kernel32 = ctypes.windll.kernel32
    mutex = kernel32.CreateMutexW(None, True, mutex_name)
    last_error = kernel32.GetLastError()
    if last_error == 183:  # ERROR_ALREADY_EXISTS
        kernel32.CloseHandle(mutex)
        return None  # another instance is running
    return mutex  # keep alive to hold the lock

import customtkinter as ctk

from config import load_config
import database
import i18n
from tracker import WindowTracker
from scheduler import Scheduler
from tray import TrayApp
from popup_manager import (
    PopupManager, EVENT_BIG_BREAK, EVENT_SMALL_BREAK,
    EVENT_EYE_EXERCISE, EVENT_WATER_REMINDER,
)


class HealthDeskApp:
    def __init__(self):
        self.config = load_config()
        i18n.load_locale(self.config.get("language", "pl"))
        database.init_db()
        database.close_orphaned_sessions()

        # Initialize ad system
        try:
            import ads
            ads.init()
        except Exception:
            pass

        # Initialize telemetry
        try:
            import telemetry
            telemetry.init()
            telemetry.install_global_handler()
            telemetry.track("app_start")
        except Exception:
            pass

        last_break = database.get_last_break_time()
        self.session_id = database.start_session()

        # Hidden root window for customtkinter
        self.root = ctk.CTk()
        self.root.withdraw()
        try:
            from generate_icon import generate_icon
            self.root.iconbitmap(generate_icon())
        except Exception:
            pass
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("green")

        # Window tracker
        self.tracker = WindowTracker(interval=5)

        # Popup manager — centralizes popup display and queuing
        self.popup_manager = PopupManager(
            root=self.root,
            show_callbacks={
                EVENT_BIG_BREAK: self._show_big_break,
                EVENT_SMALL_BREAK: self._show_small_break,
                EVENT_EYE_EXERCISE: self._show_eye_exercise,
                EVENT_WATER_REMINDER: self._show_water_reminder,
            },
        )

        # Scheduler — sends events to popup_manager instead of direct UI
        self.scheduler = Scheduler(
            config=self.config,
            callbacks={
                "on_small_break": lambda: self.popup_manager.enqueue(EVENT_SMALL_BREAK),
                "on_big_break": lambda: self.popup_manager.enqueue(EVENT_BIG_BREAK),
                "on_water_reminder": lambda: self.popup_manager.enqueue(EVENT_WATER_REMINDER),
                "on_eye_exercise": lambda: self.popup_manager.enqueue(EVENT_EYE_EXERCISE),
            },
            last_break_time=last_break,
        )
        self.popup_manager.set_scheduler(self.scheduler)

        # Tray
        self.tray = TrayApp(
            callbacks={
                "on_open": self._on_open,
                "on_pause": self._on_pause,
                "on_quit": self._on_quit,
                "on_water": None,
            }
        )

        self._main_win = None

    def run(self):
        self.tracker.start()
        self.scheduler.start()

        # Auto-play audio from last session
        self._autoplay_audio()

        # Run tray in separate thread (it has its own event loop)
        tray_thread = threading.Thread(target=self.tray.run, daemon=True)
        tray_thread.start()

        # tkinter mainloop on main thread
        self.root.mainloop()

    def _autoplay_audio(self):
        """Restore audio from last session at 10% volume."""
        if not self.config.get("audio_autoplay", True):
            return
        source = self.config.get("audio_last_source")
        audio_type = self.config.get("audio_last_type")
        if not source or not audio_type:
            return

        startup_vol = self.config.get("audio_last_volume", 10)

        try:
            if source == "native":
                import audio_engine
                audio_engine.set_volume(startup_vol / 100.0)
                audio_engine.play(audio_type)
            elif source == "youtube":
                import yt_player
                yt_player.set_volume(startup_vol)
                yt_player.play(station_key=audio_type)
        except Exception:
            pass

    def _show_small_break(self, on_close=None):
        duration = self.config.get("small_break_duration_sec", 20)
        mode = self.config.get("break_mode", "moderate")
        if mode == "aggressive":
            from ui.break_fullscreen import BreakFullscreen
            BreakFullscreen(break_type="small", duration_sec=duration, on_close=on_close)
        else:
            from ui.break_window import BreakWindow
            BreakWindow(break_type="small", duration_sec=duration, on_close=on_close)

    def _show_big_break(self, on_close=None):
        duration = self.config.get("big_break_duration_min", 5) * 60
        mode = self.config.get("break_mode", "moderate")
        include_eyes = self.scheduler.include_eyes_in_big_break

        def _after_big_break():
            """Big break done — optionally show eyes, then stretch, then notify manager."""
            if include_eyes:
                from ui.exercises import EyeExerciseWindow
                EyeExerciseWindow(on_close=lambda: self.root.after(0, _show_stretch))
            else:
                _show_stretch()

        def _show_stretch():
            from ui.exercises import StretchExerciseWindow
            StretchExerciseWindow(on_close=on_close)

        if mode == "aggressive":
            from ui.break_fullscreen import BreakFullscreen
            BreakFullscreen(break_type="big", duration_sec=duration, on_close=_after_big_break)
        else:
            from ui.break_window import BreakWindow
            BreakWindow(break_type="big", duration_sec=duration, on_close=_after_big_break)

    def _show_water_reminder(self, on_close=None):
        from ui.water_widget import WaterReminderWindow
        WaterReminderWindow(daily_goal=self.config.get("water_daily_goal", 8), on_close=on_close)

    def _show_eye_exercise(self, on_close=None):
        from ui.exercises import EyeExerciseWindow
        EyeExerciseWindow(on_close=on_close)

    def _on_open(self):
        self.root.after(0, self._show_main)

    def _show_main(self):
        if self._main_win is not None and self._main_win.winfo_exists():
            self._main_win.focus()
            return
        from ui.main_window import MainWindow
        self._main_win = MainWindow(self)

    def _on_pause(self, paused: bool):
        self.scheduler.toggle_pause(paused)

    def _on_quit(self):
        self.tracker.stop()
        self.scheduler.stop()
        try:
            import audio_engine
            audio_engine.stop()
        except Exception:
            pass
        try:
            import yt_player
            yt_player.stop()
        except Exception:
            pass
        try:
            import telemetry
            telemetry.track("app_stop")
        except Exception:
            pass
        database.end_session(self.session_id)
        self.root.after(0, self.root.quit)


def main():
    mutex = _check_single_instance()
    if mutex is None:
        # Already running - try to show message and exit
        try:
            cfg = load_config()
            i18n.load_locale(cfg.get("language", "pl"))
            ctypes.windll.user32.MessageBoxW(
                0,
                i18n.t("status.already_running"),
                "HealthDesk",
                0x40,  # MB_ICONINFORMATION
            )
        except Exception:
            pass
        sys.exit(0)

    app = HealthDeskApp()
    app.run()


if __name__ == "__main__":
    main()
