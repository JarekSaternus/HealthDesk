import random
import customtkinter as ctk
from i18n import t


def _get_eye_exercises() -> list[dict]:
    """Get eye exercises from locale, with hardcoded fallback."""
    from i18n import _resolve, _strings, _fallback
    data = _resolve("exercise.eye.exercises", _strings)
    if data is None:
        data = _resolve("exercise.eye.exercises", _fallback)
    if isinstance(data, list):
        return data
    # Final fallback
    return [
        {"name": "Eye movement", "icon": "\u2195",
         "steps": ["Look up", "Look down", "Look left", "Look right"], "duration": 30},
    ]


def _get_stretch_exercises() -> list[dict]:
    """Get stretch exercises from locale, with hardcoded fallback."""
    from i18n import _resolve, _strings, _fallback
    data = _resolve("exercise.stretch.exercises", _strings)
    if data is None:
        data = _resolve("exercise.stretch.exercises", _fallback)
    if isinstance(data, list):
        return data
    return [
        {"name": "Stretch", "icon": "\ud83e\udd38", "desc": "Stretch your body"},
    ]


class EyeExerciseWindow(ctk.CTkToplevel):
    def __init__(self, on_close=None):
        super().__init__()
        self._on_close = on_close
        self._exercise_done = False
        exercises = _get_eye_exercises()
        exercise = random.choice(exercises)

        try:
            import audio_engine
            audio_engine.play_start_chime()
        except Exception:
            pass

        self.title(t("exercise.eye.title"))
        try:
            from generate_icon import generate_icon
            self.after(200, lambda: self.iconbitmap(generate_icon()))
        except Exception:
            pass
        self.geometry("420x400")
        self.resizable(False, False)
        self.attributes("-topmost", True)

        self.update_idletasks()
        x = (self.winfo_screenwidth() - 420) // 2
        y = (self.winfo_screenheight() - 400) // 2
        self.geometry(f"+{x}+{y}")

        # Header
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(pady=(25, 5))
        ctk.CTkLabel(header, text=exercise.get("icon", "\U0001f441"),
                     font=ctk.CTkFont(size=28)).pack(side="left", padx=(0, 10))
        ctk.CTkLabel(header, text=t("exercise.eye.title"),
                     font=ctk.CTkFont(size=20, weight="bold")).pack(side="left")

        ctk.CTkLabel(self, text=exercise["name"], font=ctk.CTkFont(size=16),
                     text_color="#3498db").pack(pady=(5, 10))

        # Steps in a card
        card = ctk.CTkFrame(self, corner_radius=12, fg_color="#1e2530")
        card.pack(fill="x", padx=30, pady=5)

        steps = exercise.get("steps", [])
        for i, step in enumerate(steps):
            step_frame = ctk.CTkFrame(card, fg_color="transparent")
            step_frame.pack(fill="x", padx=15, pady=(8 if i == 0 else 3, 8 if i == len(steps) - 1 else 3))
            ctk.CTkLabel(step_frame, text=f"  {i+1}.", font=ctk.CTkFont(size=13, weight="bold"),
                         text_color="#3498db", width=30).pack(side="left")
            ctk.CTkLabel(step_frame, text=step, font=ctk.CTkFont(size=13),
                         anchor="w").pack(side="left")

        # Timer
        self.remaining = exercise.get("duration", 30)
        self.label_timer = ctk.CTkLabel(self, text=f"{self.remaining}s",
                                        font=ctk.CTkFont(size=36, weight="bold"),
                                        text_color="#2ecc71")
        self.label_timer.pack(pady=(15, 5))

        self.progress = ctk.CTkProgressBar(self, width=250, height=6,
                                           progress_color="#3498db", fg_color="#2d2d3e",
                                           corner_radius=3)
        self.progress.pack(pady=(0, 10))
        self.progress.set(1.0)
        self._total = self.remaining

        ctk.CTkButton(self, text=t("exercise.eye.close"), command=self._close, width=100,
                      fg_color="transparent", hover_color="#3a3a4a",
                      border_width=1, border_color="#555555",
                      corner_radius=10).pack(pady=5)

        self.protocol("WM_DELETE_WINDOW", self._close)
        self._tick()

    def _tick(self):
        if self.remaining <= 0:
            self._exercise_done = True
            self._close()
            return
        self.label_timer.configure(text=f"{self.remaining}s")
        self.progress.set(self.remaining / self._total)
        self.remaining -= 1
        self.after(1000, self._tick)

    def _close(self):
        if self._exercise_done:
            try:
                import telemetry
                telemetry.track("exercise_done", {"type": "eye"})
            except Exception:
                pass
        self.destroy()
        if self._on_close:
            self._on_close()


class StretchExerciseWindow(ctk.CTkToplevel):
    def __init__(self, on_close=None):
        super().__init__()
        self._on_close = on_close
        exercises = _get_stretch_exercises()
        exercise = random.choice(exercises)

        try:
            import audio_engine
            audio_engine.play_start_chime()
        except Exception:
            pass

        self.title(t("exercise.stretch.window_title"))
        try:
            from generate_icon import generate_icon
            self.after(200, lambda: self.iconbitmap(generate_icon()))
        except Exception:
            pass
        self.geometry("480x400")
        self.resizable(False, False)
        self.attributes("-topmost", True)

        self.update_idletasks()
        x = (self.winfo_screenwidth() - 480) // 2
        y = (self.winfo_screenheight() - 400) // 2
        self.geometry(f"+{x}+{y}")

        # Header
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(pady=(25, 5))
        ctk.CTkLabel(header, text=exercise.get("icon", "\ud83e\udd38"),
                     font=ctk.CTkFont(size=28)).pack(side="left", padx=(0, 10))
        ctk.CTkLabel(header, text=t("exercise.stretch.title"),
                     font=ctk.CTkFont(size=20, weight="bold")).pack(side="left")

        ctk.CTkLabel(self, text=exercise["name"], font=ctk.CTkFont(size=16),
                     text_color="#e67e22").pack(pady=(5, 10))

        # Instructions card
        card = ctk.CTkFrame(self, corner_radius=12, fg_color="#1e2530")
        card.pack(fill="x", padx=30, pady=5)
        ctk.CTkLabel(card, text=exercise.get("desc", ""), font=ctk.CTkFont(size=13),
                     justify="left", wraplength=400).pack(padx=20, pady=18)

        # Tip
        ctk.CTkLabel(self, text=t("exercise.stretch.tip"),
                     font=ctk.CTkFont(size=12), text_color="#555d6b").pack(pady=(15, 5))

        ctk.CTkButton(self, text=t("exercise.stretch.done"), command=self._close,
                      fg_color="#2ecc71", hover_color="#27ae60",
                      width=140, height=38, corner_radius=10,
                      font=ctk.CTkFont(size=14, weight="bold")).pack(pady=10)

        self.protocol("WM_DELETE_WINDOW", self._close)

    def _close(self):
        try:
            import telemetry
            telemetry.track("exercise_done", {"type": "stretch"})
        except Exception:
            pass
        self.destroy()
        if self._on_close:
            self._on_close()
