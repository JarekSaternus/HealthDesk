import threading
import time
from datetime import datetime

# Protection zone: ±5 minutes around small/big breaks
PROTECTION_ZONE_SEC = 5 * 60


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
        self._popup_paused = False  # separate flag for popup-driven pause
        self._thread: threading.Thread | None = None
        self._include_eyes_in_big_break = False

        # Calculate initial timer offsets from last break
        now = time.time()
        if last_break_time is not None:
            elapsed = (datetime.now() - last_break_time).total_seconds()
            small_interval = config.get("small_break_interval_min", 20) * 60
            big_interval = config.get("big_break_interval_min", 60) * 60

            # Long absence (>30 min) = fresh start with full intervals
            if elapsed > 30 * 60:
                self._last_small_break = now
                self._last_big_break = now
            else:
                small_remaining = small_interval - elapsed
                big_remaining = big_interval - elapsed
                # If slightly overdue, give 5 min grace instead of firing immediately
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

    @property
    def include_eyes_in_big_break(self) -> bool:
        """Check and consume the flag for merging eye exercises into big break."""
        val = self._include_eyes_in_big_break
        self._include_eyes_in_big_break = False
        return val

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

    def pause_for_popup(self):
        """Pause timer counting while a popup is active."""
        self._popup_paused = True

    def resume_after_popup(self):
        """Resume after popup closes — reset all timers from now."""
        self._popup_paused = False
        now = time.time()
        self._last_small_break = now
        self._last_big_break = now
        self._last_water = now
        self._last_eye = now

    def update_config(self, config: dict):
        self.config = config

    def _in_work_hours(self) -> bool:
        if not self.config.get("work_hours_enabled", False):
            return True
        now = datetime.now().strftime("%H:%M")
        start = self.config.get("work_hours_start", "08:00")
        end = self.config.get("work_hours_end", "18:00")
        return start <= now <= end

    def _time_to_next(self, last: float, interval: float, now: float) -> float:
        """Seconds until next event fires. Negative = overdue."""
        return interval - (now - last)

    def _run(self):
        while self._running:
            time.sleep(1)

            if self._paused:
                if time.time() >= self._pause_until:
                    self.resume()
                continue

            if self._popup_paused:
                continue

            if not self._in_work_hours():
                continue

            now = time.time()

            small_interval = self.config.get("small_break_interval_min", 20) * 60
            big_interval = self.config.get("big_break_interval_min", 60) * 60
            water_interval = self.config.get("water_interval_min", 30) * 60
            eye_interval = self.config.get("eye_exercise_interval_min", 30) * 60

            time_to_small = self._time_to_next(self._last_small_break, small_interval, now)
            time_to_big = self._time_to_next(self._last_big_break, big_interval, now)
            time_to_eye = self._time_to_next(self._last_eye, eye_interval, now)
            time_to_water = self._time_to_next(self._last_water, water_interval, now)

            # --- Big break fires ---
            if time_to_big <= 0:
                self._last_big_break = now
                self._last_small_break = now  # reset small break too

                # Smart merge: absorb eye exercise if it's close
                if time_to_eye <= PROTECTION_ZONE_SEC:
                    self._include_eyes_in_big_break = True
                    self._last_eye = now  # reset eye timer

                # Delay water if it's in the protection zone
                if 0 < time_to_water <= PROTECTION_ZONE_SEC:
                    pass  # water will fire naturally after break (timers reset in resume_after_popup)

                cb = self.callbacks.get("on_big_break")
                if cb:
                    cb()
                continue

            # --- Small break fires ---
            if time_to_small <= 0:
                # Skip small break if big break is imminent
                if time_to_big <= PROTECTION_ZONE_SEC:
                    self._last_small_break = now  # reset, big break will handle it
                    continue

                self._last_small_break = now
                cb = self.callbacks.get("on_small_break")
                if cb:
                    cb()
                continue

            # --- Eye exercise ---
            if time_to_eye <= 0:
                # Delay if we're in small break protection zone
                if abs(time_to_small) <= PROTECTION_ZONE_SEC or time_to_small <= PROTECTION_ZONE_SEC:
                    if time_to_small > 0:
                        # Small break coming soon — skip eyes, they'll reset after break
                        continue
                # Delay if big break is imminent (eyes will be merged)
                if time_to_big <= PROTECTION_ZONE_SEC:
                    continue

                self._last_eye = now
                cb = self.callbacks.get("on_eye_exercise")
                if cb:
                    cb()

            # --- Water reminder ---
            if time_to_water <= 0:
                # Delay if we're in any break protection zone
                if time_to_small <= PROTECTION_ZONE_SEC and time_to_small > 0:
                    continue
                if time_to_big <= PROTECTION_ZONE_SEC and time_to_big > 0:
                    continue

                self._last_water = now
                cb = self.callbacks.get("on_water_reminder")
                if cb:
                    cb()
