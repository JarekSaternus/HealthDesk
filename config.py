import json
import os
import sys
import uuid
import winreg

CONFIG_DIR = os.path.join(os.environ.get("APPDATA", ""), "HealthDesk")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
DB_FILE = os.path.join(CONFIG_DIR, "healthdesk.db")
_UUID_FILE = os.path.join(CONFIG_DIR, ".client_uuid")

APP_VERSION = "1.1.0"

DEFAULTS = {
    "small_break_interval_min": 20,
    "small_break_duration_sec": 20,
    "big_break_interval_min": 60,
    "big_break_duration_min": 5,
    "break_mode": "moderate",  # "moderate" or "aggressive"
    "water_interval_min": 30,
    "water_daily_goal": 8,
    "eye_exercise_interval_min": 30,
    "work_hours_start": "08:00",
    "work_hours_end": "18:00",
    "work_hours_enabled": False,
    "autostart": False,
    "sound_notifications": True,
    "show_ads": True,
    "telemetry_enabled": True,
    "track_window_titles": False,
}


def get_client_uuid() -> str:
    """Get or create a persistent client UUID for analytics."""
    os.makedirs(CONFIG_DIR, exist_ok=True)
    try:
        if os.path.exists(_UUID_FILE):
            with open(_UUID_FILE, "r") as f:
                client_id = f.read().strip()
            if client_id:
                return client_id
    except OSError:
        pass
    client_id = str(uuid.uuid4())
    try:
        with open(_UUID_FILE, "w") as f:
            f.write(client_id)
    except OSError:
        pass
    return client_id


def load_config() -> dict:
    os.makedirs(CONFIG_DIR, exist_ok=True)
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                user = json.load(f)
            merged = {**DEFAULTS, **user}
            return merged
        except (json.JSONDecodeError, OSError):
            pass
    return dict(DEFAULTS)


def save_config(cfg: dict):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def set_autostart(enable: bool):
    key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
    app_name = "HealthDesk"
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE)
        if enable:
            if getattr(sys, 'frozen', False):
                # Running as PyInstaller bundle - use the .exe directly
                cmd = f'"{sys.executable}"'
            else:
                # Running from Python source
                exe = sys.executable
                if exe.endswith("python.exe"):
                    pythonw = exe.replace("python.exe", "pythonw.exe")
                    if os.path.exists(pythonw):
                        exe = pythonw
                script = os.path.abspath(os.path.join(os.path.dirname(__file__), "main.py"))
                cmd = f'"{exe}" "{script}"'
            winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, cmd)
        else:
            try:
                winreg.DeleteValue(key, app_name)
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    except OSError:
        pass
