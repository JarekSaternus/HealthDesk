use tauri::{
    AppHandle, Manager, Emitter,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
};
use std::sync::Arc;
use std::sync::Mutex;

use crate::audio::AudioEngine;
use crate::config::AppConfig;
use crate::database::Database;
use crate::i18n::I18n;
use crate::scheduler::SharedScheduler;
use crate::youtube::YouTubePlayer;

const NATIVE_SOUNDS: &[&str] = &["brown_noise", "rain", "white_noise", "pink_noise", "drone", "forest"];

fn is_audio_playing(audio: &AudioEngine, yt: &YouTubePlayer) -> bool {
    audio.is_playing() || yt.is_playing()
}

fn music_label(i18n: &I18n, audio: &AudioEngine, yt: &YouTubePlayer) -> String {
    if is_audio_playing(audio, yt) {
        i18n.t("tray.music_stop")
    } else {
        i18n.t("tray.music_play")
    }
}

pub fn setup_tray(
    app: &AppHandle,
    db: Arc<Database>,
    scheduler: SharedScheduler,
    config: Arc<Mutex<AppConfig>>,
    i18n: Arc<I18n>,
    audio: Arc<AudioEngine>,
    yt_player: Arc<YouTubePlayer>,
) -> Result<(), String> {
    let open = MenuItem::with_id(app, "open", &i18n.t("tray.open"), true, None::<&str>).map_err(|e| e.to_string())?;
    let water = MenuItem::with_id(app, "log_water", &i18n.t("tray.log_water"), true, None::<&str>).map_err(|e| e.to_string())?;
    let music = MenuItem::with_id(app, "toggle_music", &music_label(&i18n, &audio, &yt_player), true, None::<&str>).map_err(|e| e.to_string())?;
    let pause = MenuItem::with_id(app, "pause", &i18n.t("tray.pause"), true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", &i18n.t("tray.quit"), true, None::<&str>).map_err(|e| e.to_string())?;

    let menu = Menu::with_items(app, &[&open, &water, &music, &pause, &quit]).map_err(|e| e.to_string())?;

    let db_clone = db.clone();
    let scheduler_clone = scheduler.clone();
    let config_clone = config.clone();
    let audio_clone = audio.clone();
    let yt_clone = yt_player.clone();

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip(&i18n.t("tray.tooltip"))
        .menu(&menu)
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                "open" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                "log_water" => {
                    let conn = db_clone.0.lock().unwrap();
                    let _ = crate::database::log_water(&conn, 1);
                    let _ = app.emit("water:logged", ());
                }
                "toggle_music" => {
                    let playing = is_audio_playing(&audio_clone, &yt_clone);
                    if playing {
                        audio_clone.stop();
                        yt_clone.stop();
                    } else {
                        let cfg = config_clone.lock().unwrap();
                        let last_type = cfg.audio_last_type.as_deref().unwrap_or("");
                        let last_source = cfg.audio_last_source.as_deref().unwrap_or("");
                        let vol = cfg.audio_last_volume;

                        if !last_type.is_empty() && NATIVE_SOUNDS.contains(&last_type) {
                            audio_clone.play(last_type, vol);
                        } else if last_source == "youtube" && !last_type.is_empty() {
                            let _ = yt_clone.play_search(last_type, vol);
                        }
                    }
                    let _ = app.emit("audio:changed", ());
                }
                "pause" => {
                    let mut sched = scheduler_clone.lock().unwrap();
                    if sched.paused {
                        sched.resume();
                    } else {
                        sched.pause(30);
                    }
                    let _ = app.emit("scheduler:pause-toggled", sched.paused);
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn update_tray_language(app: &AppHandle, i18n: &I18n) -> Result<(), String> {
    let tray = app.tray_by_id("main-tray").ok_or("Tray not found")?;

    let open = MenuItem::with_id(app, "open", &i18n.t("tray.open"), true, None::<&str>).map_err(|e| e.to_string())?;
    let water = MenuItem::with_id(app, "log_water", &i18n.t("tray.log_water"), true, None::<&str>).map_err(|e| e.to_string())?;
    // For language update, default to "play" label (actual state checked on click)
    let music = MenuItem::with_id(app, "toggle_music", &i18n.t("tray.music_play"), true, None::<&str>).map_err(|e| e.to_string())?;
    let pause = MenuItem::with_id(app, "pause", &i18n.t("tray.pause"), true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", &i18n.t("tray.quit"), true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&open, &water, &music, &pause, &quit]).map_err(|e| e.to_string())?;

    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    let _ = tray.set_tooltip(Some(&i18n.t("tray.tooltip")));

    Ok(())
}
