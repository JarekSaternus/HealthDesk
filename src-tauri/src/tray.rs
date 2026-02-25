use tauri::{
    AppHandle, Manager, Emitter,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
};
use std::sync::Arc;
use std::sync::Mutex;

use crate::config::AppConfig;
use crate::database::Database;
use crate::scheduler::SharedScheduler;

pub fn setup_tray(
    app: &AppHandle,
    db: Arc<Database>,
    scheduler: SharedScheduler,
    _config: Arc<Mutex<AppConfig>>,
) -> Result<(), String> {
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>).map_err(|e| e.to_string())?;
    let water = MenuItem::with_id(app, "log_water", "I drank a glass", true, None::<&str>).map_err(|e| e.to_string())?;
    let pause = MenuItem::with_id(app, "pause", "Pause (30 min)", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;

    let menu = Menu::with_items(app, &[&open, &water, &pause, &quit]).map_err(|e| e.to_string())?;

    let _app_handle = app.clone();
    let db_clone = db.clone();
    let scheduler_clone = scheduler.clone();

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("HealthDesk - Healthy work")
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
