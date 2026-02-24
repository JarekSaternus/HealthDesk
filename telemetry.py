"""Telemetry client for HealthDesk — anonymous usage analytics and error reporting.

Events are queued locally and sent to the API in a background thread.
All failures are silent — telemetry never crashes the app.
"""
import json
import os
import platform
import queue
import ssl
import threading
import traceback
import urllib.request

# SSL context for self-signed VPS certificate
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

from config import get_client_uuid, load_config, APP_VERSION

API_URL = "https://172.104.234.32/healthdesk/api/events"

_queue: queue.Queue = queue.Queue(maxsize=100)
_worker_thread: threading.Thread | None = None
_started = False


def init():
    """Start the telemetry worker thread."""
    global _worker_thread, _started
    if _started:
        return
    _started = True
    _worker_thread = threading.Thread(target=_worker, daemon=True)
    _worker_thread.start()


def track(event_type: str, payload: dict | None = None):
    """Queue a telemetry event. Non-blocking, never raises."""
    try:
        if not _is_enabled():
            return
        event = {
            "client_uuid": get_client_uuid(),
            "event_type": event_type,
            "payload": payload or {},
            "app_version": APP_VERSION,
            "os_version": platform.version(),
        }
        _queue.put_nowait(event)
    except Exception:
        pass


def track_error(error: Exception, context: str = ""):
    """Track an error/exception event with traceback."""
    try:
        tb = traceback.format_exception(type(error), error, error.__traceback__)
        payload = {
            "error_type": type(error).__name__,
            "error_message": str(error)[:500],
            "traceback": "".join(tb)[-2000:],
            "context": context,
        }
        track("error", payload)
    except Exception:
        pass


def install_global_handler():
    """Install a global exception handler that reports unhandled exceptions."""
    import sys

    _original_hook = sys.excepthook

    def _handle_exception(exc_type, exc_value, exc_tb):
        try:
            tb = traceback.format_exception(exc_type, exc_value, exc_tb)
            payload = {
                "error_type": exc_type.__name__,
                "error_message": str(exc_value)[:500],
                "traceback": "".join(tb)[-2000:],
                "context": "unhandled_exception",
            }
            # Send directly (bypassing queue) since app may be crashing
            _send_event({
                "client_uuid": get_client_uuid(),
                "event_type": "error",
                "payload": payload,
                "app_version": APP_VERSION,
                "os_version": platform.version(),
            })
        except Exception:
            pass
        _original_hook(exc_type, exc_value, exc_tb)

    sys.excepthook = _handle_exception


def _is_enabled() -> bool:
    try:
        return load_config().get("telemetry_enabled", True)
    except Exception:
        return False


def _send_event(event: dict) -> bool:
    """Send a single event to the API. Returns True on success."""
    try:
        data = json.dumps(event).encode("utf-8")
        req = urllib.request.Request(
            API_URL,
            data=data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": f"HealthDesk/{APP_VERSION}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5, context=_ssl_ctx) as resp:
            return resp.status == 200
    except Exception:
        return False


def _worker():
    """Background worker that drains the queue and sends events."""
    batch: list[dict] = []
    while True:
        try:
            # Block until first event
            event = _queue.get(timeout=30)
            batch.append(event)
            # Drain up to 10 more without blocking
            for _ in range(10):
                try:
                    batch.append(_queue.get_nowait())
                except queue.Empty:
                    break
            # Send each event
            for ev in batch:
                _send_event(ev)
            batch.clear()
        except queue.Empty:
            continue
        except Exception:
            batch.clear()
