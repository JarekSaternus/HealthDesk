import random
import customtkinter as ctk

EYE_EXERCISES = [
    {
        "name": "Ruch galkami ocznymi",
        "icon": "↕",
        "steps": [
            "Patrz w gore (3 sek)",
            "Patrz w dol (3 sek)",
            "Patrz w lewo (3 sek)",
            "Patrz w prawo (3 sek)",
            "Powtorz 3 razy",
        ],
        "duration": 30,
    },
    {
        "name": "Mruganie",
        "icon": "😌",
        "steps": [
            "Mrugaj szybko przez 15 sekund",
            "Zamknij oczy na 5 sekund",
            "Powtorz 2 razy",
        ],
        "duration": 40,
    },
    {
        "name": "Fokus bliski / daleki",
        "icon": "🔍",
        "steps": [
            "Patrz na kciuk (30 cm) przez 5 sek",
            "Patrz na daleki obiekt przez 5 sek",
            "Powtorz 5 razy",
        ],
        "duration": 50,
    },
    {
        "name": "Osemka",
        "icon": "∞",
        "steps": [
            "Wyobraz sobie duza osemke na scianie",
            "Sledz jej ksztalt oczami powoli",
            "Zmien kierunek po 15 sekundach",
        ],
        "duration": 30,
    },
]

STRETCH_EXERCISES = [
    {
        "name": "Rozciaganie szyi",
        "icon": "🦒",
        "desc": (
            "1. Przechyl glowe w prawo (15 sek)\n"
            "2. Przechyl glowe w lewo (15 sek)\n"
            "3. Opusc brode na klatke (15 sek)\n"
            "4. Odchyl glowe do tylu (15 sek)"
        ),
    },
    {
        "name": "Rozciaganie ramion",
        "icon": "💪",
        "desc": (
            "1. Prawa reka nad glowe, zegnij w lokciu\n"
            "   Lewa reka naciska na lokiec (15 sek)\n"
            "2. Powtorz na druga strone\n"
            "3. Splec rece za plecami, wypnij klatke (15 sek)"
        ),
    },
    {
        "name": "Skret tulowia",
        "icon": "🔄",
        "desc": (
            "1. Siadz prosto na krzesle\n"
            "2. Poloz prawa reke na lewym kolanie\n"
            "3. Delikatnie obracaj sie w lewo (15 sek)\n"
            "4. Powtorz na druga strone"
        ),
    },
    {
        "name": "Nadgarstki i dlonie",
        "icon": "🤲",
        "desc": (
            "1. Wyciagnij reke przed siebie, dlonia do gory\n"
            "2. Druga reka delikatnie ociagnij palce w dol (15 sek)\n"
            "3. Powtorz z dlonia do dolu\n"
            "4. Krecenie nadgarstkow - 10 razy w kazda strone"
        ),
    },
    {
        "name": "Rozciaganie nog",
        "icon": "🦵",
        "desc": (
            "1. Wyprostuj noge przed siebie (15 sek)\n"
            "2. Zmien noge (15 sek)\n"
            "3. Wstan - 5 przysiadow\n"
            "4. Wstan na palce 10 razy"
        ),
    },
    {
        "name": "Rozciaganie plecow",
        "icon": "🐈",
        "desc": (
            "1. Siadz na brzegu krzesla\n"
            "2. Schyl sie, rece dotykaja podlogi (15 sek)\n"
            "3. Wstan, rece do gory, wychyl sie lekko w tyl (10 sek)\n"
            "4. Koci grzbiet: wygiecie plecow siedzac (10 sek)"
        ),
    },
]


class EyeExerciseWindow(ctk.CTkToplevel):
    def __init__(self, on_close=None):
        super().__init__()
        self._on_close = on_close
        self._exercise_done = False
        exercise = random.choice(EYE_EXERCISES)

        try:
            import audio_engine
            audio_engine.play_start_chime()
        except Exception:
            pass

        self.title("Cwiczenie oczu")
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
        ctk.CTkLabel(header, text=exercise.get("icon", "👁"),
                     font=ctk.CTkFont(size=28)).pack(side="left", padx=(0, 10))
        ctk.CTkLabel(header, text="Cwiczenie oczu",
                     font=ctk.CTkFont(size=20, weight="bold")).pack(side="left")

        ctk.CTkLabel(self, text=exercise["name"], font=ctk.CTkFont(size=16),
                     text_color="#3498db").pack(pady=(5, 10))

        # Steps in a card
        card = ctk.CTkFrame(self, corner_radius=12, fg_color="#1e2530")
        card.pack(fill="x", padx=30, pady=5)

        for i, step in enumerate(exercise["steps"]):
            step_frame = ctk.CTkFrame(card, fg_color="transparent")
            step_frame.pack(fill="x", padx=15, pady=(8 if i == 0 else 3, 8 if i == len(exercise["steps"]) - 1 else 3))
            ctk.CTkLabel(step_frame, text=f"  {i+1}.", font=ctk.CTkFont(size=13, weight="bold"),
                         text_color="#3498db", width=30).pack(side="left")
            ctk.CTkLabel(step_frame, text=step, font=ctk.CTkFont(size=13),
                         anchor="w").pack(side="left")

        # Timer
        self.remaining = exercise["duration"]
        self.label_timer = ctk.CTkLabel(self, text=f"{self.remaining}s",
                                        font=ctk.CTkFont(size=36, weight="bold"),
                                        text_color="#2ecc71")
        self.label_timer.pack(pady=(15, 5))

        self.progress = ctk.CTkProgressBar(self, width=250, height=6,
                                           progress_color="#3498db", fg_color="#2d2d3e",
                                           corner_radius=3)
        self.progress.pack(pady=(0, 10))
        self.progress.set(1.0)
        self._total = exercise["duration"]

        ctk.CTkButton(self, text="Zamknij", command=self._close, width=100,
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
        exercise = random.choice(STRETCH_EXERCISES)

        try:
            import audio_engine
            audio_engine.play_start_chime()
        except Exception:
            pass

        self.title("Rozciaganie")
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
        ctk.CTkLabel(header, text=exercise.get("icon", "🤸"),
                     font=ctk.CTkFont(size=28)).pack(side="left", padx=(0, 10))
        ctk.CTkLabel(header, text="Czas na rozciaganie!",
                     font=ctk.CTkFont(size=20, weight="bold")).pack(side="left")

        ctk.CTkLabel(self, text=exercise["name"], font=ctk.CTkFont(size=16),
                     text_color="#e67e22").pack(pady=(5, 10))

        # Instructions card
        card = ctk.CTkFrame(self, corner_radius=12, fg_color="#1e2530")
        card.pack(fill="x", padx=30, pady=5)
        ctk.CTkLabel(card, text=exercise["desc"], font=ctk.CTkFont(size=13),
                     justify="left", wraplength=400).pack(padx=20, pady=18)

        # Tip
        ctk.CTkLabel(self, text="Nie forsuj sie - ruch powinien byc delikatny!",
                     font=ctk.CTkFont(size=12), text_color="#555d6b").pack(pady=(15, 5))

        ctk.CTkButton(self, text="Gotowe!", command=self._close,
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
