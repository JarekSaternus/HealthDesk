use chrono::Local;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::Mutex;

use crate::config;

pub struct Database(pub Mutex<Connection>);

impl Database {
    pub fn new() -> Result<Self, String> {
        let path = config::db_path();
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS breaks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                type TEXT NOT NULL,
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
            );",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self(Mutex::new(conn)))
    }
}

#[derive(Debug, Serialize)]
pub struct BreakRecord {
    pub id: i64,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub break_type: String,
    pub duration_sec: i64,
    pub skipped: bool,
}

#[derive(Debug, Serialize)]
pub struct ActivitySummary {
    pub process_name: String,
    pub category: String,
    pub total_sec: i64,
}

#[derive(Debug, Serialize)]
pub struct CategorySummary {
    pub category: String,
    pub total_sec: i64,
}

#[derive(Debug, Serialize)]
pub struct DailyTotal {
    pub day: String,
    pub total_sec: i64,
}

#[derive(Debug, Serialize)]
pub struct DailyBreaks {
    pub day: String,
    pub count: i64,
    pub skipped_count: i64,
}

fn today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn week_ago_str() -> String {
    let d = Local::now().date_naive() - chrono::Duration::days(6);
    d.format("%Y-%m-%d").to_string()
}

pub fn log_break(conn: &Connection, break_type: &str, duration_sec: i64, skipped: bool) -> Result<(), String> {
    conn.execute(
        "INSERT INTO breaks (timestamp, type, duration_sec, skipped) VALUES (?1, ?2, ?3, ?4)",
        params![Local::now().to_rfc3339(), break_type, duration_sec, skipped as i32],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_breaks_today(conn: &Connection) -> Result<Vec<BreakRecord>, String> {
    let today = today_str();
    let mut stmt = conn
        .prepare("SELECT id, timestamp, type, duration_sec, skipped FROM breaks WHERE timestamp >= ?1 ORDER BY timestamp")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![today], |row| {
            Ok(BreakRecord {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                break_type: row.get(2)?,
                duration_sec: row.get(3)?,
                skipped: row.get::<_, i32>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn log_water(conn: &Connection, glasses: i32) -> Result<(), String> {
    conn.execute(
        "INSERT INTO water (timestamp, glasses) VALUES (?1, ?2)",
        params![Local::now().to_rfc3339(), glasses],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_water_today(conn: &Connection) -> Result<i64, String> {
    let today = today_str();
    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(glasses), 0) FROM water WHERE timestamp >= ?1",
            params![today],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(total)
}

pub fn log_activity(
    conn: &Connection,
    process_name: &str,
    window_title: &str,
    duration_sec: i64,
    category: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO window_activity (timestamp, process_name, window_title, duration_sec, category) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![Local::now().to_rfc3339(), process_name, window_title, duration_sec, category],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_activity_today(conn: &Connection) -> Result<Vec<ActivitySummary>, String> {
    let today = today_str();
    let mut stmt = conn
        .prepare(
            "SELECT process_name, category, SUM(duration_sec) as total_sec \
             FROM window_activity WHERE timestamp >= ?1 \
             GROUP BY process_name ORDER BY total_sec DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![today], |row| {
            Ok(ActivitySummary {
                process_name: row.get(0)?,
                category: row.get(1)?,
                total_sec: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_category_summary_today(conn: &Connection) -> Result<Vec<CategorySummary>, String> {
    let today = today_str();
    let mut stmt = conn
        .prepare(
            "SELECT category, SUM(duration_sec) as total_sec \
             FROM window_activity WHERE timestamp >= ?1 GROUP BY category",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![today], |row| {
            Ok(CategorySummary {
                category: row.get(0)?,
                total_sec: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_total_time_today(conn: &Connection) -> Result<i64, String> {
    let today = today_str();
    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(duration_sec), 0) FROM window_activity WHERE timestamp >= ?1",
            params![today],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(total)
}

pub fn get_weekly_daily_totals(conn: &Connection) -> Result<Vec<DailyTotal>, String> {
    let week_ago = week_ago_str();
    let mut stmt = conn
        .prepare(
            "SELECT DATE(timestamp) as day, SUM(duration_sec) as total_sec \
             FROM window_activity WHERE timestamp >= ?1 \
             GROUP BY DATE(timestamp) ORDER BY day",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![week_ago], |row| {
            Ok(DailyTotal {
                day: row.get(0)?,
                total_sec: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_weekly_breaks(conn: &Connection) -> Result<Vec<DailyBreaks>, String> {
    let week_ago = week_ago_str();
    let mut stmt = conn
        .prepare(
            "SELECT DATE(timestamp) as day, COUNT(*) as count, \
             SUM(CASE WHEN skipped=1 THEN 1 ELSE 0 END) as skipped_count \
             FROM breaks WHERE timestamp >= ?1 GROUP BY DATE(timestamp) ORDER BY day",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![week_ago], |row| {
            Ok(DailyBreaks {
                day: row.get(0)?,
                count: row.get(1)?,
                skipped_count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn start_session(conn: &Connection) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO sessions (start_time) VALUES (?1)",
        params![Local::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

pub fn end_session(conn: &Connection, session_id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE sessions SET end_time = ?1 WHERE id = ?2",
        params![Local::now().to_rfc3339(), session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_last_break_time(conn: &Connection) -> Result<Option<String>, String> {
    let today = today_str();
    let result: Result<String, _> = conn.query_row(
        "SELECT timestamp FROM breaks WHERE timestamp >= ?1 ORDER BY timestamp DESC LIMIT 1",
        params![today],
        |row| row.get(0),
    );
    match result {
        Ok(ts) => Ok(Some(ts)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn close_orphaned_sessions(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "UPDATE sessions SET end_time = start_time WHERE end_time IS NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
