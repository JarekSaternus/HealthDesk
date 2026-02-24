"""Ad system for HealthDesk - shows small banners during breaks.

Ads are loaded from the HealthDesk API server.
Fallback to built-in placeholder ads if offline.
Includes URL validation, content sanitization, and event reporting.
"""
import html
import json
import os
import random
import re
import threading
import ssl
import urllib.request
import urllib.parse

# SSL context for self-signed VPS certificate
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

from config import CONFIG_DIR, get_client_uuid, APP_VERSION

# Remote API to fetch ads from
ADS_URL = "https://172.104.234.32/healthdesk/api/ads"
ADS_EVENT_URL = "https://172.104.234.32/healthdesk/api/ads/event"

# Local cache
_CACHE_FILE = os.path.join(CONFIG_DIR, "ads_cache.json")
_ads: list[dict] = []
_loaded = False
_lock = threading.Lock()

# Built-in fallback ads (used when no remote URL or offline)
_FALLBACK_ADS = [
    {
        "id": 0,
        "title": "HealthDesk Pro",
        "text": "Wspieraj rozwoj aplikacji - przejdz na wersje Pro!",
        "url": "",
        "bg": "#1a2744",
        "accent": "#2ecc71",
    },
    {
        "id": 0,
        "title": "Tip: Ergonomia",
        "text": "Monitor na wysokosci oczu, stopy plasko na podlodze",
        "url": "",
        "bg": "#1e2636",
        "accent": "#3498db",
    },
    {
        "id": 0,
        "title": "Tip: Nawodnienie",
        "text": "Trzymaj butelke wody na biurku - pij regularnie!",
        "url": "",
        "bg": "#1e2636",
        "accent": "#3498db",
    },
]

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
# Private/reserved IP ranges for URL validation
_PRIVATE_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "[::1]"}


def is_safe_url(url: str) -> bool:
    """Check if URL is safe to open in browser."""
    if not url:
        return False
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        if not parsed.netloc:
            return False
        host = parsed.hostname or ""
        if host in _PRIVATE_HOSTS:
            return False
        # Block private IP ranges
        if host.startswith(("10.", "192.168.", "169.254.")):
            return False
        if host.startswith("172."):
            parts = host.split(".")
            if len(parts) >= 2:
                try:
                    second = int(parts[1])
                    if 16 <= second <= 31:
                        return False
                except ValueError:
                    pass
        return True
    except Exception:
        return False


def _sanitize_ad(ad: dict) -> dict:
    """Sanitize ad content for safe display."""
    sanitized = dict(ad)
    # Escape HTML in text fields
    title = str(ad.get("title", ""))[:100]
    text = str(ad.get("text", ""))[:200]
    sanitized["title"] = html.escape(title)
    sanitized["text"] = html.escape(text)
    # Validate URL
    url = str(ad.get("url", ""))
    sanitized["url"] = url if is_safe_url(url) else ""
    # Validate colors
    bg = str(ad.get("bg", "#1a2744"))
    sanitized["bg"] = bg if _HEX_COLOR_RE.match(bg) else "#1a2744"
    accent = str(ad.get("accent", "#f39c12"))
    sanitized["accent"] = accent if _HEX_COLOR_RE.match(accent) else "#f39c12"
    return sanitized


def _report_event(ad_id: int, event_type: str):
    """Report an ad event (impression/click) to the API in background."""
    def _send():
        try:
            data = json.dumps({
                "ad_id": ad_id,
                "event_type": event_type,
                "client_uuid": get_client_uuid(),
            }).encode("utf-8")
            req = urllib.request.Request(
                ADS_EVENT_URL,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": f"HealthDesk/{APP_VERSION}",
                },
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5, context=_ssl_ctx)
        except Exception:
            pass
    threading.Thread(target=_send, daemon=True).start()


def report_click(ad_id: int):
    """Report ad click event. Call before opening URL."""
    _report_event(ad_id, "click")


def _fetch_remote():
    """Fetch ads from remote URL in background."""
    global _ads, _loaded
    if not ADS_URL:
        return

    try:
        req = urllib.request.Request(ADS_URL, headers={"User-Agent": f"HealthDesk/{APP_VERSION}"})
        with urllib.request.urlopen(req, timeout=5, context=_ssl_ctx) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, list) and len(data) > 0:
            sanitized = [_sanitize_ad(ad) for ad in data]
            with _lock:
                _ads = sanitized
                _loaded = True
            # Cache locally
            os.makedirs(CONFIG_DIR, exist_ok=True)
            with open(_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(sanitized, f, ensure_ascii=False)
    except Exception:
        pass


def _load_cache():
    """Load ads from local cache."""
    global _ads, _loaded
    try:
        if os.path.exists(_CACHE_FILE):
            with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and len(data) > 0:
                with _lock:
                    _ads = [_sanitize_ad(ad) for ad in data]
                    _loaded = True
    except Exception:
        pass


def init():
    """Initialize ad system - load cache then fetch remote."""
    _load_cache()
    if ADS_URL:
        threading.Thread(target=_fetch_remote, daemon=True).start()


def get_ad() -> dict | None:
    """Get a random ad to display. Returns dict with id, title, text, url, bg, accent.
    Also fires an impression event for non-fallback ads."""
    from config import load_config
    if not load_config().get("show_ads", True):
        return None

    with _lock:
        pool = _ads if _ads else _FALLBACK_ADS
    ad = random.choice(pool)

    # Fire impression event for real ads (not fallback)
    ad_id = ad.get("id", 0)
    if ad_id:
        _report_event(ad_id, "impression")

    return ad
