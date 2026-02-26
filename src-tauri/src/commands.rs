use std::sync::Arc;
use tauri::{Emitter, State};

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
    scheduler: State<SharedScheduler>,
) -> Result<(), String> {
    let mut cfg = new_config;
    // Apply work method preset (overrides interval fields)
    crate::config::apply_preset(&mut cfg);
    crate::config::save_config(&cfg)?;

    let mut conf = config.0.lock().unwrap();
    let old_cfg = conf.clone();
    *conf = cfg.clone();
    drop(conf);

    // Only reset timers if break intervals actually changed
    let intervals_changed =
        old_cfg.small_break_interval_min != cfg.small_break_interval_min
        || old_cfg.big_break_interval_min != cfg.big_break_interval_min
        || old_cfg.water_interval_min != cfg.water_interval_min
        || old_cfg.eye_exercise_interval_min != cfg.eye_exercise_interval_min;

    if intervals_changed {
        let mut sched = scheduler.lock().unwrap();
        // Recalculate timers: keep elapsed time, cap to new interval
        let now = std::time::Instant::now();
        let clamp = |last: std::time::Instant, new_interval_min: u32| -> std::time::Instant {
            let elapsed = last.elapsed().as_secs_f64();
            let new_interval = new_interval_min as f64 * 60.0;
            if elapsed >= new_interval {
                // Already past new interval — trigger soon (5s grace)
                now - std::time::Duration::from_secs_f64(new_interval - 5.0)
            } else {
                last // Keep current progress
            }
        };
        sched.last_small_break = clamp(sched.last_small_break, cfg.small_break_interval_min);
        sched.last_big_break = clamp(sched.last_big_break, cfg.big_break_interval_min);
        sched.last_water = clamp(sched.last_water, cfg.water_interval_min);
        sched.last_eye = clamp(sched.last_eye, cfg.eye_exercise_interval_min);
    }

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
pub fn reset_timers(scheduler: State<SharedScheduler>, config: State<ConfigState>, app: tauri::AppHandle) {
    let now = std::time::Instant::now();
    let mut sched = scheduler.lock().unwrap();
    sched.last_small_break = now;
    sched.last_big_break = now;
    sched.last_water = now;
    sched.last_eye = now;
    sched.pause_start = None;
    let cfg = config.0.lock().unwrap();
    let state = sched.get_state(&cfg);
    let _ = app.emit("scheduler:state-update", &state);
}

#[tauri::command]
pub fn get_scheduler_state(
    scheduler: State<SharedScheduler>,
    config: State<ConfigState>,
) -> SchedulerState {
    let cfg = config.0.lock().unwrap();
    scheduler.lock().unwrap().get_state(&cfg)
}

#[tauri::command]
pub fn toggle_pause(paused: bool, scheduler: State<SharedScheduler>, config: State<ConfigState>, app: tauri::AppHandle) {
    let mut sched = scheduler.lock().unwrap();
    if paused {
        sched.pause(24 * 60); // Effectively indefinite until user resumes
    } else {
        sched.resume();
    }
    let cfg = config.0.lock().unwrap();
    let state = sched.get_state(&cfg);
    let _ = app.emit("scheduler:state-update", &state);
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
pub fn set_sound_volume(volume: u32, audio: State<Arc<AudioEngine>>, yt: State<Arc<YouTubePlayer>>) {
    audio.set_volume(volume);
    yt.set_volume(volume);
}

#[tauri::command]
pub fn get_audio_state(audio: State<Arc<AudioEngine>>, yt: State<Arc<YouTubePlayer>>) -> serde_json::Value {
    let rodio_playing = audio.is_playing();
    let yt_playing = yt.is_playing();
    serde_json::json!({
        "playing": rodio_playing || yt_playing,
        "current_type": audio.current_type(),
        "source": if yt_playing { "youtube" } else { "rodio" },
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
