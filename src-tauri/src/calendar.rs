use base64::Engine;
use chrono::TimeZone;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::config::{self, AppConfig};

// Public OAuth client ID for the HealthDesk desktop app (Google Cloud project
// `healthdesk-gsc`). Per Google docs for "Desktop app" clients this identifier
// is NOT a secret. Authorization is secured via PKCE — no client_secret is
// required or sent during the code exchange.
const CLIENT_ID: &str = "1025633965653-6v5huo0qasiameq0qm4vhto7oafgdlr1.apps.googleusercontent.com";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const CALENDAR_EVENTS_API: &str = "https://www.googleapis.com/calendar/v3/calendars";
const CALENDAR_LIST_API: &str = "https://www.googleapis.com/calendar/v3/users/me/calendarList";

// Keyring service/account labels. Single entry stores all three token fields
// as JSON; this avoids multiple keyring round-trips and keeps migration simple.
const KEYRING_SERVICE: &str = "HealthDesk";
const KEYRING_ACCOUNT: &str = "google_oauth";

/// Token bundle persisted in the OS keyring (Credential Manager on Windows,
/// Keychain on macOS, Secret Service on Linux).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GoogleTokens {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("keyring init failed: {}", e))
}

pub fn load_tokens() -> GoogleTokens {
    let entry = match keyring_entry() {
        Ok(e) => e,
        Err(e) => {
            log::warn!("calendar: {}", e);
            return GoogleTokens::default();
        }
    };
    match entry.get_password() {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(keyring::Error::NoEntry) => GoogleTokens::default(),
        Err(e) => {
            log::warn!("calendar: keyring read failed: {}", e);
            GoogleTokens::default()
        }
    }
}

pub fn save_tokens(tokens: &GoogleTokens) -> Result<(), String> {
    let entry = keyring_entry()?;
    let json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    entry
        .set_password(&json)
        .map_err(|e| format!("keyring store failed: {}", e))
}

pub fn delete_tokens() -> Result<(), String> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete failed: {}", e)),
    }
}

/// Sync helper used by commands.rs and the background sync loop to check
/// whether Google Calendar is currently linked without fetching the token.
pub fn has_google_tokens() -> bool {
    load_tokens().refresh_token.is_some()
}

/// One-shot migration from plaintext config.json → keyring. Called on app
/// startup (lib.rs). Clears the config fields after move so subsequent saves
/// never re-introduce plaintext tokens.
pub fn migrate_tokens_from_config(config_state: &Arc<Mutex<AppConfig>>) {
    let (access, refresh, expires_at) = {
        let cfg = match config_state.lock() {
            Ok(c) => c,
            Err(p) => {
                log::error!("calendar: config mutex poisoned during migration: {}", p);
                p.into_inner()
            }
        };
        (
            cfg.google_access_token.clone(),
            cfg.google_refresh_token.clone(),
            cfg.google_token_expires_at,
        )
    };
    if access.is_none() && refresh.is_none() {
        return;
    }
    let tokens = GoogleTokens {
        access_token: access,
        refresh_token: refresh,
        expires_at,
    };
    if let Err(e) = save_tokens(&tokens) {
        log::error!("calendar: token migration to keyring failed: {}", e);
        return;
    }
    // Migration succeeded — wipe plaintext fields and persist config.
    let cfg_to_save = {
        let mut cfg = match config_state.lock() {
            Ok(c) => c,
            Err(p) => p.into_inner(),
        };
        cfg.google_access_token = None;
        cfg.google_refresh_token = None;
        cfg.google_token_expires_at = None;
        cfg.clone()
    };
    if let Err(e) = config::save_config(&cfg_to_save) {
        log::error!("calendar: config save after migration failed: {}", e);
    } else {
        log::info!("calendar: migrated Google OAuth tokens to OS keyring");
    }
}

// --- PKCE + state helpers ---

fn random_base64url(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

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
    // Parsed once at ingestion — used by is_in_meeting / meeting_starting_soon
    // to avoid re-parsing RFC3339 strings on every scheduler tick.
    #[serde(skip)]
    pub start_dt: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(skip)]
    pub end_dt: Option<chrono::DateTime<chrono::FixedOffset>>,
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

/// Start OAuth flow: open browser, listen for callback, exchange code for tokens.
/// Uses PKCE (RFC 7636) + random `state` parameter — no client_secret needed.
pub async fn oauth_connect(app: AppHandle, config_state: Arc<Mutex<AppConfig>>) -> Result<(), String> {
    // Start local HTTP server on random port (tiny_http, blocking — run on
    // a blocking task so the async runtime isn't stalled).
    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind OAuth callback listener: {}", e))?;
    let port = match server.server_addr() {
        tiny_http::ListenAddr::IP(addr) => addr.port(),
        #[cfg(unix)]
        tiny_http::ListenAddr::Unix(_) => return Err("unexpected unix socket".into()),
    };
    let redirect_uri = format!("http://localhost:{}", port);

    // PKCE: 64-byte verifier → SHA-256 challenge.
    // State: 32-byte random nonce to protect against CSRF / local code-injection.
    let code_verifier = random_base64url(64);
    let code_challenge = pkce_challenge(&code_verifier);
    let state = random_base64url(32);

    // Build auth URL
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?\
        client_id={}&redirect_uri={}&response_type=code&\
        scope=https://www.googleapis.com/auth/calendar.readonly&\
        access_type=offline&prompt=consent&\
        state={}&code_challenge={}&code_challenge_method=S256",
        CLIENT_ID,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&state),
        urlencoding::encode(&code_challenge),
    );

    // Open browser (tauri_plugin_shell::Shell::open is deprecated; use `open` crate)
    if let Err(e) = open::that(&auth_url) {
        log::warn!("failed to open browser for OAuth: {}", e);
    }

    // Wait for callback on blocking task (tiny_http.recv_timeout is sync).
    let expected_state = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(server, &expected_state, std::time::Duration::from_secs(120))
    })
    .await
    .map_err(|e| format!("OAuth callback join error: {}", e))??;

    // Exchange code for tokens (PKCE — no client_secret)
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", CLIENT_ID),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", code_verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token exchange error: {}", body));
    }

    let token_resp: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;

    // Save tokens to OS keyring (never config.json)
    let expires_at = chrono::Utc::now().timestamp() + token_resp.expires_in as i64;
    let existing = load_tokens();
    let tokens = GoogleTokens {
        access_token: Some(token_resp.access_token),
        refresh_token: token_resp.refresh_token.or(existing.refresh_token),
        expires_at: Some(expires_at),
    };
    save_tokens(&tokens)?;

    // Mark calendar as enabled in config (no secrets in config.json)
    {
        let mut cfg = config_state
            .lock()
            .map_err(|e| format!("config mutex poisoned: {}", e))?;
        cfg.google_calendar_enabled = true;
        let _ = config::save_config(&cfg);
    }

    let _ = app.emit("calendar:connected", ());
    Ok(())
}

/// Best-effort Google OAuth token revocation via https://oauth2.googleapis.com/revoke.
/// Failures are logged but do not block local disconnect — the token stays in the
/// keyring only if local deletion also fails.
async fn revoke_remote_token(token: &str) {
    let client = reqwest::Client::new();
    match client
        .post(REVOKE_URL)
        .form(&[("token", token)])
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            log::info!("calendar: Google token revocation succeeded");
        }
        Ok(resp) => {
            log::warn!(
                "calendar: Google token revocation returned HTTP {}",
                resp.status()
            );
        }
        Err(e) => {
            log::warn!(
                "calendar: Google token revocation network error (timeout={})",
                e.is_timeout()
            );
        }
    }
}

/// Disconnect: revoke token at Google (best-effort), clear keyring, disable in config.
pub async fn disconnect(config_state: &Arc<Mutex<AppConfig>>) -> Result<(), String> {
    // Prefer revoking the refresh_token — Google revokes the whole grant.
    // Fall back to access_token if refresh is missing.
    let existing = load_tokens();
    let to_revoke = existing.refresh_token.clone().or(existing.access_token.clone());
    if let Some(token) = to_revoke {
        revoke_remote_token(&token).await;
    }

    if let Err(e) = delete_tokens() {
        log::error!("calendar: failed to delete tokens from keyring: {}", e);
        return Err(e);
    }
    let mut cfg = config_state
        .lock()
        .map_err(|e| format!("config mutex poisoned: {}", e))?;
    cfg.google_calendar_enabled = false;
    cfg.google_access_token = None;
    cfg.google_refresh_token = None;
    cfg.google_token_expires_at = None;
    cfg.google_calendar_ids = Vec::new();
    let _ = config::save_config(&cfg);
    Ok(())
}

/// Ensure access token is valid, refresh if needed. Reads and writes the
/// keyring (never config.json) for token material.
pub async fn ensure_valid_token(config_state: &Arc<Mutex<AppConfig>>) -> Result<String, String> {
    let tokens = load_tokens();
    let now = chrono::Utc::now().timestamp();
    let token_valid = tokens.expires_at.map(|e| now < e - 60).unwrap_or(false);

    if token_valid {
        if let Some(token) = tokens.access_token {
            return Ok(token);
        }
    }

    // Need refresh
    let refresh = tokens
        .refresh_token
        .clone()
        .ok_or("No refresh token — reconnect Google Calendar")?;

    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("refresh_token", refresh.as_str()),
            ("client_id", CLIENT_ID),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        if body.contains("invalid_grant") {
            let _ = disconnect(config_state).await;
        }
        return Err(format!("Token refresh error: {}", body));
    }

    let token_resp: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;
    let new_expires_at = chrono::Utc::now().timestamp() + token_resp.expires_in as i64;
    let access = token_resp.access_token.clone();

    let new_tokens = GoogleTokens {
        access_token: Some(token_resp.access_token),
        refresh_token: token_resp.refresh_token.or(Some(refresh)),
        expires_at: Some(new_expires_at),
    };
    save_tokens(&new_tokens)?;

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
    let start_of_day = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| "invalid start_of_day".to_string())?;
    let end_of_day = now
        .date_naive()
        .and_hms_opt(23, 59, 59)
        .ok_or_else(|| "invalid end_of_day".to_string())?;
    // from_local_datetime can return None (DST gap) or Ambiguous (DST overlap).
    // Pick earliest valid offset in both cases — we only need a rough day window.
    let resolve_local = |dt: &chrono::NaiveDateTime| -> Result<chrono::DateTime<chrono::Local>, String> {
        match chrono::Local.from_local_datetime(dt) {
            chrono::LocalResult::Single(t) => Ok(t),
            chrono::LocalResult::Ambiguous(earliest, _) => Ok(earliest),
            chrono::LocalResult::None => Err(format!("local datetime {} does not exist (DST gap)", dt)),
        }
    };
    let time_min = resolve_local(&start_of_day)?.to_rfc3339();
    let time_max = resolve_local(&end_of_day)?.to_rfc3339();

    let client = reqwest::Client::new();

    // If no specific calendars selected, use "primary"
    let ids: Vec<String> = if calendar_ids.is_empty() {
        vec!["primary".into()]
    } else {
        calendar_ids.to_vec()
    };

    let mut all_events = Vec::new();

    for cal_id in &ids {
        let url = format!("{}/{}/events", CALENDAR_EVENTS_API, urlencoding::encode(cal_id));
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
                // cal_id is often an email address — don't log it (PII).
                // reqwest::Error Display includes the request URL, so log only
                // the status hint without the error value itself.
                log::warn!("Calendar API request failed (status={:?})", e.status());
                let _ = e;
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
                    if trimmed.chars().count() > 200 {
                        let prefix: String = trimmed.chars().take(200).collect();
                        format!("{}…", prefix)
                    } else {
                        trimmed
                    }
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

                let start_dt = chrono::DateTime::parse_from_rfc3339(&start).ok();
                let end_dt = chrono::DateTime::parse_from_rfc3339(&end).ok();

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
                    start_dt,
                    end_dt,
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

/// Background sync task — runs every minute (frequent for pre-meeting accuracy)
pub fn start_calendar_sync(
    app: AppHandle,
    config_state: Arc<Mutex<AppConfig>>,
    calendar_state: SharedCalendarState,
) {
    tauri::async_runtime::spawn(async move {
        // Initial grace period before first tick (let the app finish starting)
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(60));
        // First .tick() returns immediately — we've already slept, so the pattern is fine.
        loop {
            ticker.tick().await;

            let (enabled, cal_ids) = match config_state.lock() {
                Ok(cfg) => (cfg.google_calendar_enabled, cfg.google_calendar_ids.clone()),
                Err(p) => {
                    log::error!("sync: config mutex poisoned: {}", p);
                    let cfg = p.into_inner();
                    (cfg.google_calendar_enabled, cfg.google_calendar_ids.clone())
                }
            };
            if !(enabled && has_google_tokens()) {
                continue;
            }

            match ensure_valid_token(&config_state).await {
                Ok(token) => {
                    if let Ok(events) = fetch_upcoming_events(&token, &cal_ids).await {
                        match calendar_state.lock() {
                            Ok(mut state) => {
                                state.events = events.clone();
                                state.last_fetched = Some(Instant::now());
                            }
                            Err(p) => {
                                log::error!("sync: calendar_state mutex poisoned: {}", p);
                                let mut state = p.into_inner();
                                state.events = events.clone();
                                state.last_fetched = Some(Instant::now());
                            }
                        }
                        let _ = app.emit("calendar:events-updated", &events);
                    }
                }
                Err(_) => {
                    // ensure_valid_token error may contain a response body;
                    // avoid logging it to keep calendar metadata out of logs.
                    log::warn!("Calendar sync: token refresh / fetch failed");
                }
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
        match (e.start_dt, e.end_dt) {
            (Some(start), Some(end)) => now >= start && now < end,
            _ => false,
        }
    })
}

/// Find the next meeting starting within `within_secs` seconds
pub fn meeting_starting_soon(events: &[CalendarEvent], within_secs: i64) -> Option<CalendarEvent> {
    let now = chrono::Local::now();
    events
        .iter()
        .find(|e| {
            if e.is_all_day {
                return false;
            }
            match e.start_dt {
                Some(start) => {
                    let until = start.signed_duration_since(now).num_seconds();
                    until > 0 && until <= within_secs
                }
                None => false,
            }
        })
        .cloned()
}

// --- OAuth callback (tiny_http, sync — runs on blocking task) ---

fn wait_for_callback(
    server: tiny_http::Server,
    expected_state: &str,
    timeout: std::time::Duration,
) -> Result<String, String> {
    let request = server
        .recv_timeout(timeout)
        .map_err(|e| format!("callback recv: {}", e))?
        .ok_or_else(|| "OAuth timeout — nie zalogowano w ciągu 2 minut".to_string())?;

    let url = request.url().to_string();
    let query = url.split_once('?').map(|(_, q)| q).unwrap_or("");
    let params: std::collections::HashMap<String, String> = query
        .split('&')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            let decoded = urlencoding::decode(v).ok()?.into_owned();
            Some((k.to_string(), decoded))
        })
        .collect();

    let send_html = |req: tiny_http::Request, body: &str| {
        let header =
            "Content-Type: text/html; charset=utf-8".parse::<tiny_http::Header>().ok();
        let mut resp = tiny_http::Response::from_string(body.to_string());
        if let Some(h) = header {
            resp = resp.with_header(h);
        }
        let _ = req.respond(resp);
    };

    if let Some(err) = params.get("error") {
        send_html(
            request,
            "<html><body><h2>Błąd logowania</h2></body></html>",
        );
        return Err(format!("OAuth error: {}", err));
    }

    // Validate state before trusting the code (CSRF / code-injection guard)
    let received_state = match params.get("state") {
        Some(s) => s.clone(),
        None => {
            send_html(
                request,
                "<html><body><h2>Brak parametru state</h2></body></html>",
            );
            return Err("No state in callback".into());
        }
    };
    if received_state != expected_state {
        send_html(
            request,
            "<html><body><h2>Niezgodny state — callback odrzucony</h2></body></html>",
        );
        return Err("OAuth state mismatch — callback rejected".into());
    }

    let code = match params.get("code") {
        Some(c) => c.clone(),
        None => {
            send_html(
                request,
                "<html><body><h2>Brak kodu autoryzacji</h2></body></html>",
            );
            return Err("No code in callback".into());
        }
    };

    send_html(
        request,
        r#"<html><body style="font-family:sans-serif;text-align:center;padding-top:60px;background:#1a1f2b;color:#fff">
<h2 style="color:#2ecc71">&#10004; Połączono z Google Calendar!</h2>
<p>Możesz zamknąć to okno i wrócić do HealthDesk.</p>
</body></html>"#,
    );

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
