"""Centralny zarządca okienek — kolejka priorytetowa, deduplikacja, lifecycle."""
import threading


# Priority constants (lower = higher priority)
PRIORITY_BIG_BREAK = 1
PRIORITY_SMALL_BREAK = 2
PRIORITY_EYE_EXERCISE = 3
PRIORITY_WATER_REMINDER = 4

# Event type names
EVENT_BIG_BREAK = "big_break"
EVENT_SMALL_BREAK = "small_break"
EVENT_EYE_EXERCISE = "eye_exercise"
EVENT_WATER_REMINDER = "water_reminder"

_EVENT_PRIORITY = {
    EVENT_BIG_BREAK: PRIORITY_BIG_BREAK,
    EVENT_SMALL_BREAK: PRIORITY_SMALL_BREAK,
    EVENT_EYE_EXERCISE: PRIORITY_EYE_EXERCISE,
    EVENT_WATER_REMINDER: PRIORITY_WATER_REMINDER,
}


class PopupManager:
    """Singleton-style manager that queues popups by priority and prevents overlaps."""

    def __init__(self, root, show_callbacks: dict, scheduler=None):
        """
        root: tk root for after() scheduling
        show_callbacks: dict mapping event type -> callable that creates the UI window
            Each callable must accept on_close keyword argument.
        scheduler: Scheduler instance for pause/resume during popups
        """
        self._root = root
        self._show_callbacks = show_callbacks
        self._scheduler = scheduler
        self._lock = threading.Lock()
        self._queue: list[tuple[int, str]] = []  # (priority, event_type)
        self._active_event: str | None = None

    def set_scheduler(self, scheduler):
        self._scheduler = scheduler

    def enqueue(self, event_type: str):
        """Add popup event — called from scheduler thread, marshals to main thread."""
        self._root.after(0, lambda: self._enqueue_main(event_type))

    def _enqueue_main(self, event_type: str):
        """Process enqueue on main thread."""
        priority = _EVENT_PRIORITY.get(event_type, 99)

        with self._lock:
            # Deduplicate — don't add if same type already queued or active
            if self._active_event == event_type:
                return
            if any(et == event_type for _, et in self._queue):
                return

            if self._active_event is None:
                # Nothing active — show immediately
                self._show(event_type)
            else:
                active_priority = _EVENT_PRIORITY.get(self._active_event, 99)
                if priority < active_priority:
                    # Higher priority incoming — preempt current (except water never preempts)
                    self._queue.insert(0, (active_priority, self._active_event))
                    self._active_event = None
                    # Close will trigger _on_popup_closed, but we show new one now
                    self._show(event_type)
                else:
                    # Lower or equal priority — queue it
                    self._queue.append((priority, event_type))
                    self._queue.sort(key=lambda x: x[0])

    def _show(self, event_type: str):
        """Show a popup and pause scheduler."""
        self._active_event = event_type
        if self._scheduler:
            self._scheduler.pause_for_popup()

        callback = self._show_callbacks.get(event_type)
        if callback:
            try:
                callback(on_close=self._on_popup_closed)
            except Exception:
                # If show fails, treat as closed
                self._on_popup_closed()

    def _on_popup_closed(self):
        """Called when active popup closes — show next from queue or resume scheduler."""
        with self._lock:
            self._active_event = None
            if self._queue:
                _, next_event = self._queue.pop(0)
                # Show next after short delay to avoid visual glitch
                self._root.after(300, lambda: self._show_next(next_event))
            else:
                # Queue empty — resume scheduler timers
                if self._scheduler:
                    self._scheduler.resume_after_popup()

    def _show_next(self, event_type: str):
        with self._lock:
            if self._active_event is not None:
                # Something already showing (race condition guard)
                self._queue.insert(0, (_EVENT_PRIORITY.get(event_type, 99), event_type))
                return
        self._show(event_type)
