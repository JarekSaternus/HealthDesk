"""Native ambient sound generator - no internet, no browser."""
import threading
import numpy as np
import sounddevice as sd

_stream: sd.OutputStream | None = None
_lock = threading.Lock()
_current_type: str | None = None

# Volume: 0.0 - 1.0
_volume = 0.3
SAMPLE_RATE = 44100


def _brown_noise_callback(outdata, frames, time_info, status):
    white = np.random.randn(frames, 1).astype(np.float32)
    # Integrate white noise -> brown noise
    brown = np.cumsum(white, axis=0)
    # Normalize and apply volume
    peak = np.abs(brown).max()
    if peak > 0:
        brown = brown / peak * _volume
    outdata[:] = brown


# State for rain generator
_rain_state = {"buf": None}


def _rain_callback(outdata, frames, time_info, status):
    # Rain = pink noise + random droplet pops
    white = np.random.randn(frames, 1).astype(np.float32)
    # Simple pink noise approximation (1/f): average of multiple octaves
    pink = np.zeros((frames, 1), dtype=np.float32)
    for octave in range(6):
        step = 2 ** octave
        held = np.repeat(np.random.randn(frames // step + 1, 1), step, axis=0)[:frames]
        pink += held.astype(np.float32) / (octave + 1)
    pink = pink / np.abs(pink).max() * _volume * 0.7

    # Random droplet pops
    drops = np.zeros((frames, 1), dtype=np.float32)
    for _ in range(np.random.randint(0, 4)):
        pos = np.random.randint(0, frames)
        length = min(np.random.randint(20, 80), frames - pos)
        t = np.linspace(0, 1, length).reshape(-1, 1).astype(np.float32)
        drop = np.sin(2 * np.pi * np.random.uniform(800, 2000) * t) * np.exp(-t * 8)
        drops[pos:pos+length] += drop * _volume * 0.3

    outdata[:] = np.clip(pink + drops, -1, 1)


def _white_noise_callback(outdata, frames, time_info, status):
    outdata[:] = np.random.randn(frames, 1).astype(np.float32) * _volume * 0.4


def _pink_noise_callback(outdata, frames, time_info, status):
    pink = np.zeros((frames, 1), dtype=np.float32)
    for octave in range(7):
        step = 2 ** octave
        held = np.repeat(np.random.randn(frames // step + 1, 1), step, axis=0)[:frames]
        pink += held.astype(np.float32) / (octave + 1)
    peak = np.abs(pink).max()
    if peak > 0:
        pink = pink / peak * _volume
    outdata[:] = pink


# Drone state
_drone_state = {"phase": 0.0}


def _drone_callback(outdata, frames, time_info, status):
    # Deep ambient drone: layered sine waves with slow modulation
    t = (np.arange(frames) + _drone_state["phase"]).reshape(-1, 1).astype(np.float64)
    _drone_state["phase"] += frames

    sr = SAMPLE_RATE
    # Base frequencies (C2 + harmonics)
    out = np.zeros((frames, 1), dtype=np.float64)
    freqs = [65.41, 98.0, 130.81, 196.0]  # C2, G2, C3, G3
    amps = [0.4, 0.25, 0.2, 0.15]

    for freq, amp in zip(freqs, amps):
        # Slow frequency wobble
        wobble = 1.0 + 0.003 * np.sin(2 * np.pi * 0.07 * t / sr)
        out += amp * np.sin(2 * np.pi * freq * wobble * t / sr)

    # Slow volume swell
    swell = 0.7 + 0.3 * np.sin(2 * np.pi * 0.04 * t / sr)
    out = out * swell * _volume

    outdata[:] = np.clip(out, -1, 1).astype(np.float32)


_forest_state = {"phase": 0.0}


def _forest_callback(outdata, frames, time_info, status):
    t = (np.arange(frames) + _forest_state["phase"]).reshape(-1, 1).astype(np.float64)
    _forest_state["phase"] += frames
    sr = SAMPLE_RATE

    # Base: gentle wind (filtered noise)
    pink = np.zeros((frames, 1), dtype=np.float32)
    for octave in range(5):
        step = 2 ** octave
        held = np.repeat(np.random.randn(frames // step + 1, 1), step, axis=0)[:frames]
        pink += held.astype(np.float32) / (octave + 1.5)
    # Slow wind modulation
    wind_mod = 0.5 + 0.5 * np.sin(2 * np.pi * 0.08 * t / sr).astype(np.float32)
    wind = pink * wind_mod * 0.5

    # Bird chirps (random sine bursts at high freq)
    birds = np.zeros((frames, 1), dtype=np.float32)
    if np.random.random() < 0.15:  # ~15% chance per buffer
        pos = np.random.randint(0, max(frames - 2000, 1))
        length = min(np.random.randint(500, 2000), frames - pos)
        chirp_t = np.linspace(0, 1, length).reshape(-1, 1).astype(np.float32)
        freq = np.random.uniform(2000, 5000)
        chirp = np.sin(2 * np.pi * freq * chirp_t * (1 + 0.5 * chirp_t))
        envelope = np.sin(np.pi * chirp_t) ** 2  # smooth rise/fall
        birds[pos:pos+length] = chirp * envelope * 0.15

    out = np.clip((wind + birds) * _volume, -1, 1)
    outdata[:] = out.astype(np.float32)


SOUND_TYPES = {
    "brown_noise": {
        "name": "Brown Noise",
        "desc": "Gleboki, kojacy szum (jak wiatr)",
        "icon": "🟤",
        "callback": _brown_noise_callback,
    },
    "rain": {
        "name": "Deszcz",
        "desc": "Szum deszczu z kroplami",
        "icon": "🌧",
        "callback": _rain_callback,
    },
    "white_noise": {
        "name": "White Noise",
        "desc": "Rownomierny szum (maskowanie dzwiekow)",
        "icon": "⚪",
        "callback": _white_noise_callback,
    },
    "pink_noise": {
        "name": "Pink Noise",
        "desc": "Lagodniejszy od bialego (naturalny)",
        "icon": "🩷",
        "callback": _pink_noise_callback,
    },
    "drone": {
        "name": "Ambient Drone",
        "desc": "Gleboki ton ambient z modulacja",
        "icon": "🎵",
        "callback": _drone_callback,
    },
    "forest": {
        "name": "Las",
        "desc": "Wiatr w drzewach, ptaki",
        "icon": "🌲",
        "callback": _forest_callback,
    },
}


def play(sound_type: str):
    """Start playing a sound type. Stops any current playback first."""
    global _stream, _current_type

    with _lock:
        if _stream is not None:
            _stream.stop()
            _stream.close()
            _stream = None

        info = SOUND_TYPES.get(sound_type)
        if not info:
            return

        _current_type = sound_type
        _stream = sd.OutputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            callback=info["callback"],
            blocksize=2048,
        )
        _stream.start()
        try:
            import telemetry
            telemetry.track("audio_play", {"source": "native", "sound_type": sound_type})
        except Exception:
            pass


def stop():
    """Stop current playback."""
    global _stream, _current_type

    with _lock:
        if _stream is not None:
            _stream.stop()
            _stream.close()
            _stream = None
        _current_type = None


def is_playing() -> bool:
    return _stream is not None and _stream.active


def get_current() -> str | None:
    return _current_type


def set_volume(vol: float):
    global _volume
    _volume = max(0.0, min(1.0, vol))


def get_volume() -> float:
    return _volume


def play_chime():
    """Play a short pleasant chime to signal break is over (ascending)."""
    from config import load_config
    if not load_config().get("sound_notifications", True):
        return

    def _generate():
        sr = SAMPLE_RATE
        duration = 1.2
        t = np.linspace(0, duration, int(sr * duration), dtype=np.float32)

        # Two-tone chime (C5 + E5) - ascending, positive
        tone1 = np.sin(2 * np.pi * 523.25 * t)  # C5
        tone2 = np.sin(2 * np.pi * 659.25 * t)  # E5
        chime = (tone1 * 0.5 + tone2 * 0.5).astype(np.float32)

        # Envelope: quick attack, gentle decay
        envelope = np.exp(-t * 3.0).astype(np.float32)
        chime = chime * envelope * min(_volume * 1.5, 1.0)

        sd.play(chime, samplerate=sr)

    threading.Thread(target=_generate, daemon=True).start()


def play_start_chime():
    """Play a soft attention chime when break/exercise starts (descending)."""
    from config import load_config
    if not load_config().get("sound_notifications", True):
        return

    def _generate():
        sr = SAMPLE_RATE
        duration = 0.8
        t = np.linspace(0, duration, int(sr * duration), dtype=np.float32)

        # Descending two-note: G5 -> C5
        half = len(t) // 2
        tone = np.zeros_like(t)
        tone[:half] = np.sin(2 * np.pi * 783.99 * t[:half])   # G5
        tone[half:] = np.sin(2 * np.pi * 523.25 * t[half:])   # C5

        envelope = np.exp(-t * 2.5).astype(np.float32)
        chime = tone * envelope * min(_volume * 1.2, 0.8)

        sd.play(chime, samplerate=sr)

    threading.Thread(target=_generate, daemon=True).start()
