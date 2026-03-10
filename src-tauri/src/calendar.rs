use chrono::TimeZone;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::config::{self, AppConfig};

const CLIENT_ID: &str = "1025633965653-6v5huo0qasiameq0qm4vhto7oafgdlr1.apps.googleusercontent.com";
const CLIENT_SECRET: &str = "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";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const CALENDAR_EVENTS_API: &str = "https://www.googleapis.com/calendar/v3/calendars";
const CALENDAR_LIST_API: &str = "https://www.googleapis.com/calendar/v3/users/me/calendarList";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: String,
    pub summary: String,
    pub start: String,
    pub end: String,
    pub is_all_day: bool,
    pub organizer: Option<String>,
    pub description: Option<String>,
    pub meet_link: Option<String>,
    pub reminder_minutes: i64, // from Google Calendar, or 5 default
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarInfo {
    pub id: String,
    pub summary: String,
    pub background_color: Option<String>,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CalendarStateResponse {
    pub connected: bool,
    pub events: Vec<CalendarEvent>,
    pub calendars: Vec<CalendarInfo>,
}

pub struct CalendarState {
    pub events: Vec<CalendarEvent>,
    pub last_fetched: Option<Instant>,
}

impl CalendarState {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            last_fetched: None,
        }
    }
}

pub type SharedCalendarState = Arc<Mutex<CalendarState>>;

/// Start OAuth flow: open browser, listen for callback, exchange code for tokens
pub async fn oauth_connect(app: AppHandle, config_state: Arc<Mutex<AppConfig>>) -> Result<(), String> {
    // Start local TCP listener on random port
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://localhost:{}", port);

    // Build auth URL
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?\
        client_id={}&redirect_uri={}&response_type=code&\
        scope=https://www.googleapis.com/auth/calendar.readonly&\
        access_type=offline&prompt=consent",
        CLIENT_ID,
        urlencoding(&redirect_uri),
    );

    // Open browser
    let _ = tauri_plugin_shell::ShellExt::shell(&app)
        .open(&auth_url, None);

    // Wait for callback (with 2 min timeout)
    let code = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        wait_for_callback(listener),
    )
    .await
    .map_err(|_| "OAuth timeout — nie zalogowano w ciągu 2 minut".to_string())?
    .map_err(|e| format!("OAuth callback error: {}", e))?;

    // Exchange code for tokens
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token exchange error: {}", body));
    }

    let token_resp: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;

    // Save tokens to config
    let expires_at = chrono::Utc::now().timestamp() + token_resp.expires_in as i64;
    {
        let mut cfg = config_state.lock().unwrap();
        cfg.google_calendar_enabled = true;
        cfg.google_access_token = Some(token_resp.access_token);
        cfg.google_refresh_token = token_resp.refresh_token.or(cfg.google_refresh_token.clone());
        cfg.google_token_expires_at = Some(expires_at);
        let _ = config::save_config(&cfg);
    }

    let _ = app.emit("calendar:connected", ());
    Ok(())
}

/// Disconnect: clear tokens from config
pub fn disconnect(config_state: &Arc<Mutex<AppConfig>>) {
    let mut cfg = config_state.lock().unwrap();
    cfg.google_calendar_enabled = false;
    cfg.google_access_token = None;
    cfg.google_refresh_token = None;
    cfg.google_token_expires_at = None;
    cfg.google_calendar_ids = Vec::new();
    let _ = config::save_config(&cfg);
}

/// Ensure access token is valid, refresh if needed
pub async fn ensure_valid_token(config_state: &Arc<Mutex<AppConfig>>) -> Result<String, String> {
    let (access_token, refresh_token, expires_at) = {
        let cfg = config_state.lock().unwrap();
        (
            cfg.google_access_token.clone(),
            cfg.google_refresh_token.clone(),
            cfg.google_token_expires_at,
        )
    };

    let now = chrono::Utc::now().timestamp();
    let token_valid = expires_at.map(|e| now < e - 60).unwrap_or(false);

    if token_valid {
        if let Some(token) = access_token {
            return Ok(token);
        }
    }

    // Need refresh
    let refresh = refresh_token.ok_or("No refresh token — reconnect Google Calendar")?;

    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("refresh_token", refresh.as_str()),
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        // If invalid_grant, tokens are revoked — disconnect
        if body.contains("invalid_grant") {
            disconnect(config_state);
        }
        return Err(format!("Token refresh error: {}", body));
    }

    let token_resp: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;
    let new_expires_at = chrono::Utc::now().timestamp() + token_resp.expires_in as i64;

    let access = token_resp.access_token.clone();
    {
        let mut cfg = config_state.lock().unwrap();
        cfg.google_access_token = Some(token_resp.access_token);
        cfg.google_token_expires_at = Some(new_expires_at);
        if let Some(rt) = token_resp.refresh_token {
            cfg.google_refresh_token = Some(rt);
        }
        let _ = config::save_config(&cfg);
    }

    Ok(access)
}

/// Fetch the list of calendars for the user
pub async fn fetch_calendar_list(access_token: &str, selected_ids: &[String]) -> Result<Vec<CalendarInfo>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(CALENDAR_LIST_API)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("CalendarList API error: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("CalendarList API {}", body));
    }

    let data: GoogleCalendarListResponse = resp.json().await.map_err(|e| e.to_string())?;

    let calendars = data
        .items
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            let id = item.id.clone();
            CalendarInfo {
                selected: selected_ids.is_empty() || selected_ids.contains(&id),
                id,
                summary: item.summary.unwrap_or_else(|| "(bez nazwy)".into()),
                background_color: item.background_color,
            }
        })
        .collect();

    Ok(calendars)
}

/// Fetch events from Google Calendar for today (full work day), from selected calendars
pub async fn fetch_upcoming_events(access_token: &str, calendar_ids: &[String]) -> Result<Vec<CalendarEvent>, String> {
    let now = chrono::Local::now();
    let start_of_day = now.date_naive().and_hms_opt(0, 0, 0).unwrap();
    let end_of_day = now.date_naive().and_hms_opt(23, 59, 59).unwrap();
    let time_min = chrono::Local.from_local_datetime(&start_of_day).unwrap().to_rfc3339();
    let time_max = chrono::Local.from_local_datetime(&end_of_day).unwrap().to_rfc3339();

    let client = reqwest::Client::new();

    // If no specific calendars selected, use "primary"
    let ids: Vec<String> = if calendar_ids.is_empty() {
        vec!["primary".into()]
    } else {
        calendar_ids.to_vec()
    };

    let mut all_events = Vec::new();

    for cal_id in &ids {
        let url = format!("{}/{}/events", CALENDAR_EVENTS_API, urlencoding(cal_id));
        let resp = client
            .get(&url)
            .bearer_auth(access_token)
            .query(&[
                ("timeMin", time_min.as_str()),
                ("timeMax", time_max.as_str()),
                ("singleEvents", "true"),
                ("orderBy", "startTime"),
                ("maxResults", "20"),
            ])
            .send()
            .await;

        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                log::warn!("Calendar API error for {}: {}", cal_id, e);
                continue;
            }
        };

        if !resp.status().is_success() {
            continue;
        }

        let data: GoogleCalendarResponse = match resp.json().await {
            Ok(d) => d,
            Err(_) => continue,
        };

        let events: Vec<CalendarEvent> = data
            .items
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                let summary = item.summary.unwrap_or_else(|| "(brak tytułu)".into());
                let (start, is_all_day) = if let Some(dt) = item.start.date_time {
                    (dt, false)
                } else if let Some(d) = item.start.date {
                    (d, true)
                } else {
                    return None;
                };
                let end = item.end.date_time.or(item.end.date).unwrap_or_default();
                let organizer = item.organizer.and_then(|o| {
                    o.display_name.or(o.email)
                });
                // Trim description to first 200 chars, strip HTML tags
                let description = item.description.map(|d| {
                    let plain = d.replace("<br>", "\n")
                        .replace("<br/>", "\n")
                        .replace("&nbsp;", " ");
                    // Simple HTML tag strip
                    let mut result = String::new();
                    let mut in_tag = false;
                    for ch in plain.chars() {
                        if ch == '<' { in_tag = true; }
                        else if ch == '>' { in_tag = false; }
                        else if !in_tag { result.push(ch); }
                    }
                    let trimmed = result.trim().to_string();
                    if trimmed.len() > 200 { format!("{}…", &trimmed[..200]) } else { trimmed }
                }).filter(|d| !d.is_empty());

                // Get reminder minutes: use first popup override, or default 5 min
                let reminder_minutes = item.reminders
                    .and_then(|r| {
                        r.overrides.and_then(|ovrs| {
                            ovrs.iter()
                                .find(|o| o.method.as_deref() == Some("popup"))
                                .or_else(|| ovrs.first())
                                .and_then(|o| o.minutes)
                        })
                    })
                    .unwrap_or(5);

                Some(CalendarEvent {
                    id: item.id.unwrap_or_default(),
                    summary,
                    start,
                    end,
                    is_all_day,
                    organizer,
                    description,
                    meet_link: item.hangout_link,
                    reminder_minutes,
                })
            })
            .filter(|e| !e.is_all_day)
            .collect();

        all_events.extend(events);
    }

    // Sort by start time
    all_events.sort_by(|a, b| a.start.cmp(&b.start));
    // Deduplicate by id
    all_events.dedup_by(|a, b| a.id == b.id);

    Ok(all_events)
}

/// Background sync task — runs every 5 minutes
pub fn start_calendar_sync(
    app: AppHandle,
    config_state: Arc<Mutex<AppConfig>>,
    calendar_state: SharedCalendarState,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await; // initial delay

            loop {
                let enabled = {
                    let cfg = config_state.lock().unwrap();
                    cfg.google_calendar_enabled && cfg.google_refresh_token.is_some()
                };

                if enabled {
                    let cal_ids = {
                        let cfg = config_state.lock().unwrap();
                        cfg.google_calendar_ids.clone()
                    };
                    match ensure_valid_token(&config_state).await {
                        Ok(token) => {
                            if let Ok(events) = fetch_upcoming_events(&token, &cal_ids).await {
                                {
                                    let mut state = calendar_state.lock().unwrap();
                                    state.events = events.clone();
                                    state.last_fetched = Some(Instant::now());
                                }
                                let _ = app.emit("calendar:events-updated", &events);
                            }
                        }
                        Err(e) => {
                            log::warn!("Calendar sync error: {}", e);
                        }
                    }
                }

                tokio::time::sleep(std::time::Duration::from_secs(60)).await; // 1 min (frequent for pre-meeting accuracy)
            }
        }
    });
}

/// Check if user is currently in a meeting
pub fn is_in_meeting(events: &[CalendarEvent]) -> bool {
    let now = chrono::Local::now();
    events.iter().any(|e| {
        if e.is_all_day {
            return false;
        }
        if let (Ok(start), Ok(end)) = (
            chrono::DateTime::parse_from_rfc3339(&e.start),
            chrono::DateTime::parse_from_rfc3339(&e.end),
        ) {
            now >= start && now < end
        } else {
            false
        }
    })
}

/// Find the next meeting starting within `within_secs` seconds
pub fn meeting_starting_soon(events: &[CalendarEvent], within_secs: i64) -> Option<CalendarEvent> {
    let now = chrono::Local::now();
    events.iter().find(|e| {
        if e.is_all_day {
            return false;
        }
        if let Ok(start) = chrono::DateTime::parse_from_rfc3339(&e.start) {
            let until = start.signed_duration_since(now).num_seconds();
            until > 0 && until <= within_secs
        } else {
            false
        }
    }).cloned()
}

// --- Internal helpers ---

fn urlencoding(s: &str) -> String {
    s.replace(':', "%3A").replace('/', "%2F")
}

async fn wait_for_callback(listener: tokio::net::TcpListener) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;

    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse code from GET /?code=XXXX&scope=...
    let code = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|path| {
            path.split('?')
                .nth(1)?
                .split('&')
                .find(|p| p.starts_with("code="))
                .map(|p| p.trim_start_matches("code=").to_string())
        })
        .ok_or_else(|| "No code in callback".to_string())?;

    // Check for error
    if request.contains("error=") {
        return Err("User denied access".into());
    }

    // Send success response
    let html = r#"<html><body style="font-family:sans-serif;text-align:center;padding-top:60px;background:#1a1f2b;color:#fff">
<h2 style="color:#2ecc71">&#10004; Połączono z Google Calendar!</h2>
<p>Możesz zamknąć to okno i wrócić do HealthDesk.</p>
</body></html>"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;

    Ok(code)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    #[allow(dead_code)]
    token_type: Option<String>,
}

#[derive(Deserialize)]
struct GoogleCalendarResponse {
    items: Option<Vec<GoogleCalendarItem>>,
}

#[derive(Deserialize)]
struct GoogleCalendarListResponse {
    items: Option<Vec<GoogleCalendarListItem>>,
}

#[derive(Deserialize)]
struct GoogleCalendarListItem {
    id: String,
    summary: Option<String>,
    #[serde(rename = "backgroundColor")]
    background_color: Option<String>,
}

#[derive(Deserialize)]
struct GoogleCalendarItem {
    id: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    organizer: Option<GoogleOrganizer>,
    #[serde(rename = "hangoutLink")]
    hangout_link: Option<String>,
    reminders: Option<GoogleReminders>,
    start: GoogleDateTime,
    end: GoogleDateTime,
}

#[derive(Deserialize)]
struct GoogleOrganizer {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize)]
struct GoogleReminders {
    #[serde(rename = "useDefault")]
    use_default: Option<bool>,
    overrides: Option<Vec<GoogleReminderOverride>>,
}

#[derive(Deserialize)]
struct GoogleReminderOverride {
    method: Option<String>,
    minutes: Option<i64>,
}

#[derive(Deserialize)]
struct GoogleDateTime {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}
