import sqlite3
import threading
from datetime import datetime, date, timedelta

from config import DB_FILE

_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_FILE, check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def init_db():
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS breaks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            type TEXT NOT NULL,       -- 'small' or 'big'
            duration_sec INTEGER NOT NULL,
            skipped INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS water (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            glasses INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS window_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            process_name TEXT,
            window_title TEXT,
            duration_sec INTEGER NOT NULL DEFAULT 5,
            category TEXT DEFAULT 'Other'
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time TEXT NOT NULL,
            end_time TEXT
        );
    """)
    conn.commit()


# --- Breaks ---

def log_break(break_type: str, duration_sec: int, skipped: bool = False):
    conn = _get_conn()
    conn.execute(
        "INSERT INTO breaks (timestamp, type, duration_sec, skipped) VALUES (?, ?, ?, ?)",
        (datetime.now().isoformat(), break_type, duration_sec, int(skipped)),
    )
    conn.commit()


def get_breaks_today() -> list[dict]:
    conn = _get_conn()
    today = date.today().isoformat()
    rows = conn.execute(
        "SELECT * FROM breaks WHERE timestamp >= ? ORDER BY timestamp",
        (today,),
    ).fetchall()
    return [dict(r) for r in rows]


# --- Water ---

def log_water(glasses: int = 1):
    conn = _get_conn()
    conn.execute(
        "INSERT INTO water (timestamp, glasses) VALUES (?, ?)",
        (datetime.now().isoformat(), glasses),
    )
    conn.commit()


def get_water_today() -> int:
    conn = _get_conn()
    today = date.today().isoformat()
    row = conn.execute(
        "SELECT COALESCE(SUM(glasses), 0) as total FROM water WHERE timestamp >= ?",
        (today,),
    ).fetchone()
    return row["total"]


# --- Window Activity ---

def log_activity(process_name: str, window_title: str, duration_sec: int, category: str):
    conn = _get_conn()
    conn.execute(
        "INSERT INTO window_activity (timestamp, process_name, window_title, duration_sec, category) "
        "VALUES (?, ?, ?, ?, ?)",
        (datetime.now().isoformat(), process_name, window_title, duration_sec, category),
    )
    conn.commit()


def get_activity_today() -> list[dict]:
    conn = _get_conn()
    today = date.today().isoformat()
    rows = conn.execute(
        "SELECT process_name, category, SUM(duration_sec) as total_sec "
        "FROM window_activity WHERE timestamp >= ? "
        "GROUP BY process_name ORDER BY total_sec DESC",
        (today,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_category_summary_today() -> dict:
    conn = _get_conn()
    today = date.today().isoformat()
    rows = conn.execute(
        "SELECT category, SUM(duration_sec) as total_sec "
        "FROM window_activity WHERE timestamp >= ? GROUP BY category",
        (today,),
    ).fetchall()
    return {r["category"]: r["total_sec"] for r in rows}


def get_total_time_today() -> int:
    conn = _get_conn()
    today = date.today().isoformat()
    row = conn.execute(
        "SELECT COALESCE(SUM(duration_sec), 0) as total FROM window_activity WHERE timestamp >= ?",
        (today,),
    ).fetchone()
    return row["total"]


def get_weekly_daily_totals() -> list[dict]:
    conn = _get_conn()
    week_ago = (date.today() - timedelta(days=6)).isoformat()
    rows = conn.execute(
        "SELECT DATE(timestamp) as day, SUM(duration_sec) as total_sec "
        "FROM window_activity WHERE timestamp >= ? "
        "GROUP BY DATE(timestamp) ORDER BY day",
        (week_ago,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_weekly_breaks() -> list[dict]:
    conn = _get_conn()
    week_ago = (date.today() - timedelta(days=6)).isoformat()
    rows = conn.execute(
        "SELECT DATE(timestamp) as day, COUNT(*) as count, "
        "SUM(CASE WHEN skipped=1 THEN 1 ELSE 0 END) as skipped_count "
        "FROM breaks WHERE timestamp >= ? GROUP BY DATE(timestamp) ORDER BY day",
        (week_ago,),
    ).fetchall()
    return [dict(r) for r in rows]


# --- Sessions ---

def start_session() -> int:
    conn = _get_conn()
    cur = conn.execute(
        "INSERT INTO sessions (start_time) VALUES (?)",
        (datetime.now().isoformat(),),
    )
    conn.commit()
    return cur.lastrowid


def end_session(session_id: int):
    conn = _get_conn()
    conn.execute(
        "UPDATE sessions SET end_time = ? WHERE id = ?",
        (datetime.now().isoformat(), session_id),
    )
    conn.commit()


def get_last_break_time() -> datetime | None:
    """Return timestamp of the last break taken today, or None."""
    conn = _get_conn()
    today = date.today().isoformat()
    row = conn.execute(
        "SELECT timestamp FROM breaks WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 1",
        (today,),
    ).fetchone()
    if row:
        try:
            return datetime.fromisoformat(row["timestamp"])
        except Exception:
            return None
    return None


def close_orphaned_sessions():
    """Close any sessions that have no end_time (e.g. from a crash)."""
    conn = _get_conn()
    conn.execute(
        "UPDATE sessions SET end_time = start_time WHERE end_time IS NULL"
    )
    conn.commit()
