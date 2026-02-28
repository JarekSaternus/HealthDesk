pub mod ads;
pub mod audio;
pub mod commands;
pub mod config;
pub mod database;
pub mod i18n;
pub mod popup_manager;
pub mod scheduler;
pub mod telemetry;
pub mod tracker;
pub mod tray;
pub mod youtube;

use std::sync::{Arc, Mutex};
use tauri::{Listener, Manager, RunEvent};

use config::ConfigState;
use database::Database;
use i18n::I18n;
use scheduler::{SharedScheduler, SchedulerInner};
use telemetry::TelemetryEngine;

pub type SharedTelemetry = Arc<TelemetryEngine>;

pub fn run() {
    let cfg = config::load_config();
    let db = Database::new().expect("Failed to init database");
    let db = Arc::new(db);

    // Get last break time for scheduler continuity
    let last_break_elapsed = {
        let conn = db.0.lock().unwrap();
        database::close_orphaned_sessions(&conn).ok();
        database::get_last_break_time(&conn)
            .ok()
            .flatten()
            .and_then(|ts| {
                let parsed = chrono::DateTime::parse_from_rfc3339(&ts).ok()?;
                let elapsed = chrono::Local::now()
                    .signed_duration_since(parsed)
                    .num_seconds() as f64;
                Some(elapsed)
            })
    };

    let scheduler_inner = SchedulerInner::new(last_break_elapsed, &cfg);
    let scheduler: SharedScheduler = Arc::new(Mutex::new(scheduler_inner));
    let config_state = Arc::new(Mutex::new(cfg.clone()));
    let i18n = Arc::new(I18n::new(&cfg.language));
    let audio = Arc::new(audio::AudioEngine::new());
    // Kill any orphaned ffplay from previous run (e.g. after update/crash)
    youtube::kill_orphan_ffplay();
    let yt_player = Arc::new(youtube::YouTubePlayer::new());
    let popup_mgr = popup_manager::create_popup_manager();

    // Client UUID for telemetry/ads
    let client_uuid = get_client_uuid();

    let db_clone = db.clone();
    let scheduler_clone = scheduler.clone();
    let config_clone = config_state.clone();
    let popup_mgr_clone = popup_mgr.clone();

    let audio_exit = audio.clone();
    let yt_exit = yt_player.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ConfigState(config_state.clone()))
        .manage(db.clone())
        .manage(scheduler.clone())
        .manage(popup_mgr.clone())
        .manage(i18n.clone())
        .manage(audio.clone())
        .manage(yt_player.clone())
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Sync autostart state from config
            if cfg.autostart {
                use tauri_plugin_autostart::ManagerExt;
                let _ = app_handle.autolaunch().enable();
            }

            // Setup tray
            let _ = tray::setup_tray(&app_handle, db_clone.clone(), scheduler_clone.clone(), config_clone.clone(), i18n.clone(), audio.clone(), yt_player.clone());

            // Start session
            {
                let conn = db_clone.0.lock().unwrap();
                let _ = database::start_session(&conn);
            }

            // Start scheduler
            scheduler::start_scheduler(app_handle.clone(), scheduler_clone.clone(), config_clone.clone());

            // Start tracker
            tracker::start_tracker(db_clone.clone(), config_clone.clone(), scheduler_clone.clone());

            // Start telemetry
            let telemetry = Arc::new(TelemetryEngine::new(
                client_uuid.clone(),
                cfg.telemetry_enabled,
            ));
            app.manage(telemetry.clone());
            telemetry.track("app_start", None);

            // Setup scheduler event listeners for popup creation
            let app2 = app_handle.clone();
            let pm = popup_mgr_clone.clone();
            let sc = scheduler_clone.clone();
            let cfg2 = config_clone.clone();

            // Listen for scheduler break events
            app_handle.listen("scheduler:small-break", move |_| {
                let c = cfg2.lock().unwrap().clone();
                popup_manager::enqueue_popup(
                    &app2, &pm, &sc,
                    popup_manager::PopupType::SmallBreak,
                    &c.break_mode,
                    c.small_break_duration_sec,
                );
            });

            let app3 = app_handle.clone();
            let pm2 = popup_mgr_clone.clone();
            let sc2 = scheduler_clone.clone();
            let cfg3 = config_clone.clone();

            app_handle.listen("scheduler:big-break", move |_| {
                let c = cfg3.lock().unwrap().clone();
                popup_manager::enqueue_popup(
                    &app3, &pm2, &sc2,
                    popup_manager::PopupType::BigBreak,
                    &c.break_mode,
                    c.big_break_duration_min * 60,
                );
            });

            let app4 = app_handle.clone();
            let pm3 = popup_mgr_clone.clone();
            let sc3 = scheduler_clone.clone();

            app_handle.listen("scheduler:eye-exercise", move |_| {
                popup_manager::enqueue_popup(
                    &app4, &pm3, &sc3,
                    popup_manager::PopupType::EyeExercise,
                    "moderate",
                    30,
                );
            });

            let app5 = app_handle.clone();
            let pm4 = popup_mgr_clone.clone();
            let sc4 = scheduler_clone.clone();

            app_handle.listen("scheduler:breathing-exercise", move |_| {
                popup_manager::enqueue_popup(
                    &app5, &pm4, &sc4,
                    popup_manager::PopupType::BreathingExercise,
                    "moderate",
                    80,
                );
            });

            let app5 = app_handle.clone();
            let pm4 = popup_mgr_clone.clone();
            let sc4 = scheduler_clone.clone();

            app_handle.listen("scheduler:water-reminder", move |_| {
                popup_manager::enqueue_popup(
                    &app5, &pm4, &sc4,
                    popup_manager::PopupType::WaterReminder,
                    "moderate",
                    30,
                );
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_work_methods,
            commands::log_break,
            commands::get_breaks_today,
            commands::log_water,
            commands::get_water_today,
            commands::get_activity_today,
            commands::get_category_summary_today,
            commands::get_total_time_today,
            commands::get_weekly_daily_totals,
            commands::get_weekly_breaks,
            commands::get_break_stats_period,
            commands::get_water_period,
            commands::get_daily_water,
            commands::get_daily_totals_period,
            commands::get_daily_breaks_period,
            commands::get_scheduler_state,
            commands::snooze_break,
            commands::reset_timers,
            commands::toggle_pause,
            commands::popup_closed,
            commands::play_sound,
            commands::stop_sound,
            commands::set_sound_volume,
            commands::get_audio_state,
            commands::play_chime,
            commands::play_youtube,
            commands::play_youtube_search,
            commands::stop_youtube,
            commands::get_youtube_stations,
            commands::search_youtube_cmd,
            commands::get_youtube_state,
            commands::pause_youtube,
            commands::resume_youtube,
            commands::pause_audio,
            commands::resume_audio,
            commands::get_radio_stations,
            commands::play_radio,
            commands::get_ad,
            commands::report_ad_click,
            commands::get_translations,
            commands::change_language,
            commands::set_autostart,
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "main" {
                        // Hide to tray instead of closing
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    let label = window.label();
                    // If a popup window was destroyed (e.g. closed via X button)
                    // without calling popup_closed, unblock the scheduler
                    if label != "main" {
                        let app = window.app_handle();
                        let mgr = app.state::<popup_manager::SharedPopupManager>();
                        let sched = app.state::<SharedScheduler>();
                        let config = app.state::<ConfigState>();
                        let inner = mgr.lock().unwrap();
                        let is_current = inner.current_popup
                            .map(|p| p.label() == label)
                            .unwrap_or(false);
                        drop(inner);
                        if is_current {
                            let cfg = config.0.lock().unwrap().clone();
                            popup_manager::popup_closed(app, &mgr, &sched, &cfg.break_mode, &cfg);
                        }
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let RunEvent::Exit = event {
                audio_exit.stop();
                yt_exit.stop();
            }
        });
}

fn get_client_uuid() -> String {
    let uuid_path = config::config_dir().join(".client_uuid");
    if let Ok(id) = std::fs::read_to_string(&uuid_path) {
        let id = id.trim().to_string();
        if !id.is_empty() {
            return id;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = std::fs::create_dir_all(config::config_dir());
    let _ = std::fs::write(&uuid_path, &id);
    id
}
