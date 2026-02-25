use std::sync::Arc;
use tauri::State;

use crate::audio::AudioEngine;
use crate::config::{AppConfig, ConfigState};
use crate::database::{self, Database};
use crate::i18n::I18n;
use crate::popup_manager::{self, SharedPopupManager};
use crate::scheduler::{SharedScheduler, SchedulerState};
use crate::youtube::{self, YouTubePlayer, YTSearchResult, YTStation};

// ---- Config ----

#[tauri::command]
pub fn get_config(config: State<ConfigState>) -> AppConfig {
    config.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_config(
    new_config: AppConfig,
    config: State<ConfigState>,
    _scheduler: State<SharedScheduler>,
) -> Result<(), String> {
    crate::config::save_config(&new_config)?;
    *config.0.lock().unwrap() = new_config;
    Ok(())
}

#[tauri::command]
pub fn get_work_methods() -> std::collections::HashMap<String, crate::config::WorkMethodPreset> {
    crate::config::work_methods()
}

// ---- Database: Breaks ----

#[tauri::command]
pub fn log_break(
    break_type: String,
    duration_sec: i64,
    skipped: bool,
    db: State<Arc<Database>>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    database::log_break(&conn, &break_type, duration_sec, skipped)
}

#[tauri::command]
pub fn get_breaks_today(db: State<Arc<Database>>) -> Result<Vec<database::BreakRecord>, String> {
    let conn = db.0.lock().unwrap();
    database::get_breaks_today(&conn)
}

// ---- Database: Water ----

#[tauri::command]
pub fn log_water(glasses: i32, db: State<Arc<Database>>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    database::log_water(&conn, glasses)
}

#[tauri::command]
pub fn get_water_today(db: State<Arc<Database>>) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    database::get_water_today(&conn)
}

// ---- Database: Activity ----

#[tauri::command]
pub fn get_activity_today(db: State<Arc<Database>>) -> Result<Vec<database::ActivitySummary>, String> {
    let conn = db.0.lock().unwrap();
    database::get_activity_today(&conn)
}

#[tauri::command]
pub fn get_category_summary_today(db: State<Arc<Database>>) -> Result<Vec<database::CategorySummary>, String> {
    let conn = db.0.lock().unwrap();
    database::get_category_summary_today(&conn)
}

#[tauri::command]
pub fn get_total_time_today(db: State<Arc<Database>>) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    database::get_total_time_today(&conn)
}

#[tauri::command]
pub fn get_weekly_daily_totals(db: State<Arc<Database>>) -> Result<Vec<database::DailyTotal>, String> {
    let conn = db.0.lock().unwrap();
    database::get_weekly_daily_totals(&conn)
}

#[tauri::command]
pub fn get_weekly_breaks(db: State<Arc<Database>>) -> Result<Vec<database::DailyBreaks>, String> {
    let conn = db.0.lock().unwrap();
    database::get_weekly_breaks(&conn)
}

// ---- Scheduler ----

#[tauri::command]
pub fn get_scheduler_state(
    scheduler: State<SharedScheduler>,
    config: State<ConfigState>,
) -> SchedulerState {
    let cfg = config.0.lock().unwrap();
    scheduler.lock().unwrap().get_state(&cfg)
}

#[tauri::command]
pub fn toggle_pause(paused: bool, scheduler: State<SharedScheduler>) {
    let mut sched = scheduler.lock().unwrap();
    if paused {
        sched.pause(30);
    } else {
        sched.resume();
    }
}

#[tauri::command]
pub fn popup_closed(
    app: tauri::AppHandle,
    manager: State<SharedPopupManager>,
    scheduler: State<SharedScheduler>,
    config: State<ConfigState>,
) {
    let cfg = config.0.lock().unwrap().clone();
    popup_manager::popup_closed(&app, &manager, &scheduler, &cfg.break_mode, &cfg);
}

// ---- Audio ----

#[tauri::command]
pub fn play_sound(sound_type: String, volume: u32, audio: State<Arc<AudioEngine>>) {
    audio.play(&sound_type, volume);
}

#[tauri::command]
pub fn stop_sound(audio: State<Arc<AudioEngine>>) {
    audio.stop();
}

#[tauri::command]
pub fn set_sound_volume(volume: u32, audio: State<Arc<AudioEngine>>) {
    audio.set_volume(volume);
}

#[tauri::command]
pub fn get_audio_state(audio: State<Arc<AudioEngine>>) -> serde_json::Value {
    serde_json::json!({
        "playing": audio.is_playing(),
        "current_type": audio.current_type(),
    })
}

#[tauri::command]
pub fn play_chime(audio: State<Arc<AudioEngine>>) {
    audio.play_chime();
}

// ---- YouTube ----

#[tauri::command]
pub fn play_youtube(url: String, name: String, volume: u32, yt: State<Arc<YouTubePlayer>>) -> Result<(), String> {
    yt.play_url(&url, &name, volume)
}

#[tauri::command]
pub fn play_youtube_search(query: String, volume: u32, yt: State<Arc<YouTubePlayer>>) -> Result<(), String> {
    yt.play_search(&query, volume)
}

#[tauri::command]
pub fn stop_youtube(yt: State<Arc<YouTubePlayer>>) {
    yt.stop();
}

#[tauri::command]
pub fn get_youtube_stations() -> Vec<YTStation> {
    youtube::preset_stations()
}

#[tauri::command]
pub fn search_youtube_cmd(query: String) -> Result<Vec<YTSearchResult>, String> {
    youtube::search_youtube(&query)
}

#[tauri::command]
pub fn get_youtube_state(yt: State<Arc<YouTubePlayer>>) -> serde_json::Value {
    serde_json::json!({
        "playing": yt.is_playing(),
        "current_station": yt.current_station(),
    })
}

// ---- Ads ----

#[tauri::command]
pub async fn get_ad(client_uuid: String) -> crate::ads::Ad {
    crate::ads::fetch_ad(&client_uuid).await
}

#[tauri::command]
pub async fn report_ad_click(ad_id: String, client_uuid: String) {
    crate::ads::report_click(&ad_id, &client_uuid).await;
}

// ---- I18n ----

#[tauri::command]
pub fn get_translations(i18n: State<Arc<I18n>>) -> serde_json::Value {
    i18n.get_all()
}

#[tauri::command]
pub fn change_language(lang: String, i18n: State<Arc<I18n>>, app: tauri::AppHandle) {
    i18n.load_language(&lang);
    let _ = crate::tray::update_tray_language(&app, &i18n);
}
