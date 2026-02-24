import threading
import time
from datetime import datetime


class Scheduler:
    def __init__(self, config: dict, callbacks: dict,
                 last_break_time: datetime | None = None):
        """
        callbacks dict keys:
            on_small_break, on_big_break, on_water_reminder, on_eye_exercise
        last_break_time: datetime of last break today (for session continuity)
        """
        self.config = config
        self.callbacks = callbacks
        self._running = False
        self._paused = False
        self._pause_until: float = 0
        self._thread: threading.Thread | None = None

        # Calculate initial timer offsets from last break
        now = time.time()
        if last_break_time is not None:
            elapsed = (datetime.now() - last_break_time).total_seconds()
            small_interval = config.get("small_break_interval_min", 20) * 60
            big_interval = config.get("big_break_interval_min", 60) * 60
            small_remaining = small_interval - elapsed
            big_remaining = big_interval - elapsed
            # If overdue, set minimum 5 minutes instead of firing immediately
            if small_remaining < 0:
                small_remaining = min(300, small_interval)
            if big_remaining < 0:
                big_remaining = min(300, big_interval)
            self._last_small_break = now - (small_interval - small_remaining)
            self._last_big_break = now - (big_interval - big_remaining)
        else:
            self._last_small_break = now
            self._last_big_break = now
        self._last_water = now
        self._last_eye = now

    def start(self):
        self._running = True
        # Water and eye timers always start fresh
        self._last_water = time.time()
        self._last_eye = time.time()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def pause(self, minutes: int = 30):
        self._paused = True
        self._pause_until = time.time() + minutes * 60

    def resume(self):
        self._paused = False
        self._pause_until = 0
        now = time.time()
        self._last_small_break = now
        self._last_big_break = now
        self._last_water = now
        self._last_eye = now

    def toggle_pause(self, paused: bool):
        if paused:
            self.pause()
        else:
            self.resume()

    def update_config(self, config: dict):
        self.config = config

    def _in_work_hours(self) -> bool:
        if not self.config.get("work_hours_enabled", False):
            return True
        now = datetime.now().strftime("%H:%M")
        start = self.config.get("work_hours_start", "08:00")
        end = self.config.get("work_hours_end", "18:00")
        return start <= now <= end

    def _run(self):
        while self._running:
            time.sleep(1)

            if self._paused:
                if time.time() >= self._pause_until:
                    self.resume()
                continue

            if not self._in_work_hours():
                continue

            now = time.time()

            small_interval = self.config.get("small_break_interval_min", 20) * 60
            big_interval = self.config.get("big_break_interval_min", 60) * 60
            water_interval = self.config.get("water_interval_min", 30) * 60
            eye_interval = self.config.get("eye_exercise_interval_min", 30) * 60

            if now - self._last_big_break >= big_interval:
                self._last_big_break = now
                self._last_small_break = now  # reset small break too
                cb = self.callbacks.get("on_big_break")
                if cb:
                    cb()

            elif now - self._last_small_break >= small_interval:
                self._last_small_break = now
                cb = self.callbacks.get("on_small_break")
                if cb:
                    cb()

            if now - self._last_water >= water_interval:
                self._last_water = now
                cb = self.callbacks.get("on_water_reminder")
                if cb:
                    cb()

            if now - self._last_eye >= eye_interval:
                self._last_eye = now
                cb = self.callbacks.get("on_eye_exercise")
                if cb:
                    cb()
