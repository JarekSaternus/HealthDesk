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
from tracker import WindowTracker
from scheduler import Scheduler
from tray import TrayApp


class HealthDeskApp:
    def __init__(self):
        self.config = load_config()
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
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("green")

        # Window tracker
        self.tracker = WindowTracker(interval=5)

        # Scheduler
        self.scheduler = Scheduler(
            config=self.config,
            callbacks={
                "on_small_break": self._on_small_break,
                "on_big_break": self._on_big_break,
                "on_water_reminder": self._on_water_reminder,
                "on_eye_exercise": self._on_eye_exercise,
            },
            last_break_time=last_break,
        )

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

        # Run tray in separate thread (it has its own event loop)
        tray_thread = threading.Thread(target=self.tray.run, daemon=True)
        tray_thread.start()

        # tkinter mainloop on main thread
        self.root.mainloop()

    def _on_small_break(self):
        self.root.after(0, self._show_small_break)

    def _on_big_break(self):
        self.root.after(0, self._show_big_break)

    def _on_water_reminder(self):
        self.root.after(0, self._show_water_reminder)

    def _on_eye_exercise(self):
        self.root.after(0, self._show_eye_exercise)

    def _show_small_break(self):
        duration = self.config.get("small_break_duration_sec", 20)
        mode = self.config.get("break_mode", "moderate")
        if mode == "aggressive":
            from ui.break_fullscreen import BreakFullscreen
            BreakFullscreen(break_type="small", duration_sec=duration)
        else:
            from ui.break_window import BreakWindow
            BreakWindow(break_type="small", duration_sec=duration)

    def _show_big_break(self):
        duration = self.config.get("big_break_duration_min", 5) * 60
        mode = self.config.get("break_mode", "moderate")
        if mode == "aggressive":
            from ui.break_fullscreen import BreakFullscreen
            BreakFullscreen(break_type="big", duration_sec=duration)
        else:
            from ui.break_window import BreakWindow
            win = BreakWindow(break_type="big", duration_sec=duration)
            from ui.exercises import StretchExerciseWindow
            self.root.after(2000, lambda: StretchExerciseWindow())

    def _show_water_reminder(self):
        from ui.water_widget import WaterReminderWindow
        WaterReminderWindow(daily_goal=self.config.get("water_daily_goal", 8))

    def _show_eye_exercise(self):
        from ui.exercises import EyeExerciseWindow
        EyeExerciseWindow()

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
            ctypes.windll.user32.MessageBoxW(
                0,
                "HealthDesk juz dziala!\nSprawdz ikone w zasobniku systemowym (tray).",
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
