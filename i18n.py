"""Internationalization module for HealthDesk."""
import json
import os
import sys

from config import CONFIG_DIR

# PyInstaller extracts to _internal/, but locales/ is next to the exe
if getattr(sys, 'frozen', False):
    _APP_DIR = os.path.dirname(sys.executable)
else:
    _APP_DIR = os.path.dirname(os.path.abspath(__file__))

_BUNDLED_DIR = os.path.join(_APP_DIR, "locales")
_USER_DIR = os.path.join(CONFIG_DIR, "locales")

_strings: dict = {}
_fallback: dict = {}
_current_lang: str = "pl"


def load_locale(lang: str):
    """Load locale files: bundled JSON first, then user overlay."""
    global _strings, _fallback, _current_lang
    _current_lang = lang

    # Always load Polish as fallback
    _fallback = _load_json("pl")

    if lang == "pl":
        _strings = _fallback
    else:
        _strings = _load_json(lang)


def _load_json(lang: str) -> dict:
    """Load bundled JSON, then merge user overrides on top."""
    data = {}
    bundled = os.path.join(_BUNDLED_DIR, f"{lang}.json")
    if os.path.exists(bundled):
        try:
            with open(bundled, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass

    user_file = os.path.join(_USER_DIR, f"{lang}.json")
    if os.path.exists(user_file):
        try:
            with open(user_file, "r", encoding="utf-8") as f:
                user_data = json.load(f)
            data = _deep_merge(data, user_data)
        except (json.JSONDecodeError, OSError):
            pass

    return data


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base."""
    result = base.copy()
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def t(key: str, **kwargs) -> str:
    """Translate key using dot-notation. Falls back to Polish, then to key itself."""
    val = _resolve(key, _strings)
    if val is None:
        val = _resolve(key, _fallback)
    if val is None:
        return key
    if not isinstance(val, str):
        return key
    if kwargs:
        try:
            return val.format(**kwargs)
        except (KeyError, IndexError):
            return val
    return val


def _resolve(key: str, data: dict):
    """Resolve dot-notation key in nested dict. Returns str, list, or None."""
    parts = key.split(".")
    node = data
    for part in parts:
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return None
    if isinstance(node, (str, list)):
        return node
    return None


def get_available_languages() -> list[dict]:
    """Return list of available languages as {code, name} dicts."""
    langs = {}
    for d in [_BUNDLED_DIR, _USER_DIR]:
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.endswith(".json"):
                    code = f[:-5]
                    if code not in langs:
                        try:
                            path = os.path.join(d, f)
                            with open(path, "r", encoding="utf-8") as fh:
                                data = json.load(fh)
                            name = data.get("_name", code.upper())
                        except Exception:
                            name = code.upper()
                        langs[code] = name
    return [{"code": c, "name": n} for c, n in sorted(langs.items())]


def get_current_language() -> str:
    """Return current language code."""
    return _current_lang
