use serde::{Deserialize, Serialize};
use std::collections::BinaryHeap;
use std::cmp::Ordering;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewWindowBuilder, WebviewUrl};

use crate::scheduler::SharedScheduler;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PopupType {
    BigBreak,
    SmallBreak,
    EyeExercise,
    StretchExercise,
    WaterReminder,
    BreathingExercise,
}

impl PopupType {
    fn priority(&self) -> u8 {
        match self {
            PopupType::BigBreak => 1,
            PopupType::SmallBreak => 2,
            PopupType::EyeExercise => 3,
            PopupType::StretchExercise => 3,
            PopupType::WaterReminder => 4,
            PopupType::BreathingExercise => 3,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            PopupType::BigBreak => "break-big",
            PopupType::SmallBreak => "break-small",
            PopupType::EyeExercise => "exercise-eye",
            PopupType::StretchExercise => "exercise-stretch",
            PopupType::WaterReminder => "water-reminder",
            PopupType::BreathingExercise => "exercise-breathing",
        }
    }

    pub fn url(&self, break_mode: &str, duration_sec: u32) -> String {
        match self {
            PopupType::BigBreak => {
                if break_mode == "aggressive" {
                    format!("/break-fullscreen?type=big&duration={}", duration_sec)
                } else {
                    format!("/break?type=big&duration={}", duration_sec)
                }
            }
            PopupType::SmallBreak => {
                if break_mode == "aggressive" {
                    format!("/break-fullscreen?type=small&duration={}", duration_sec)
                } else {
                    format!("/break?type=small&duration={}", duration_sec)
                }
            }
            PopupType::EyeExercise => "/eye-exercise".into(),
            PopupType::StretchExercise => "/stretch-exercise".into(),
            PopupType::WaterReminder => "/water-reminder".into(),
            PopupType::BreathingExercise => "/breathing-exercise".into(),
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct QueuedPopup {
    popup_type: PopupType,
    seq: u64,
}

impl Ord for QueuedPopup {
    fn cmp(&self, other: &Self) -> Ordering {
        other.popup_type.priority().cmp(&self.popup_type.priority())
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

impl PartialOrd for QueuedPopup {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub struct PopupManagerInner {
    queue: BinaryHeap<QueuedPopup>,
    seq_counter: u64,
    pub current_popup: Option<PopupType>,
}

impl PopupManagerInner {
    pub fn new() -> Self {
        Self {
            queue: BinaryHeap::new(),
            seq_counter: 0,
            current_popup: None,
        }
    }
}

pub type SharedPopupManager = Arc<Mutex<PopupManagerInner>>;

pub fn create_popup_manager() -> SharedPopupManager {
    Arc::new(Mutex::new(PopupManagerInner::new()))
}

pub fn enqueue_popup(
    app: &AppHandle,
    manager: &SharedPopupManager,
    scheduler: &SharedScheduler,
    popup_type: PopupType,
    break_mode: &str,
    duration_sec: u32,
) {
    let mut mgr = manager.lock().unwrap();

    // Deduplicate
    if mgr.current_popup == Some(popup_type) {
        return;
    }
    if mgr.queue.iter().any(|q| q.popup_type == popup_type) {
        return;
    }

    mgr.seq_counter += 1;
    let entry = QueuedPopup {
        popup_type,
        seq: mgr.seq_counter,
    };

    // Preemption: if new popup has higher priority (lower number), close current
    if let Some(current) = mgr.current_popup {
        if popup_type.priority() < current.priority() {
            // Close current window
            if let Some(win) = app.get_webview_window(current.label()) {
                let _ = win.close();
            }
            mgr.current_popup = None;
        }
    }

    if mgr.current_popup.is_none() {
        // Show immediately
        mgr.current_popup = Some(popup_type);
        scheduler.lock().unwrap().pause_for_popup();
        drop(mgr);
        show_popup_window(app, popup_type, break_mode, duration_sec);
    } else {
        mgr.queue.push(entry);
    }
}

pub fn popup_closed(
    app: &AppHandle,
    manager: &SharedPopupManager,
    scheduler: &SharedScheduler,
    break_mode: &str,
    config: &crate::config::AppConfig,
) {
    let mut mgr = manager.lock().unwrap();
    let closed_type = mgr.current_popup;
    mgr.current_popup = None;

    if let Some(next) = mgr.queue.pop() {
        mgr.current_popup = Some(next.popup_type);
        drop(mgr);
        let duration = match next.popup_type {
            PopupType::SmallBreak => config.small_break_duration_sec,
            PopupType::BigBreak => config.big_break_duration_min * 60,
            _ => 30,
        };
        show_popup_window(app, next.popup_type, break_mode, duration);
    } else {
        drop(mgr);
        scheduler.lock().unwrap().resume_after_popup(closed_type);
    }
}

fn show_popup_window(app: &AppHandle, popup_type: PopupType, break_mode: &str, duration_sec: u32) {
    let label = popup_type.label();
    let url_path = popup_type.url(break_mode, duration_sec);

    // Close existing window with same label if any
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.close();
    }

    let url = WebviewUrl::App(url_path.into());

    match popup_type {
        PopupType::BigBreak | PopupType::SmallBreak => {
            if break_mode == "aggressive" {
                let _ = WebviewWindowBuilder::new(app, label, url)
                    .title("HealthDesk - Break")
                    .fullscreen(true)
                    .decorations(false)
                    .always_on_top(true)
                    .closable(false)
                    .build();
            } else {
                let _ = WebviewWindowBuilder::new(app, label, url)
                    .title("HealthDesk - Break!")
                    .inner_size(460.0, 390.0)
                    .always_on_top(true)
                    .center()
                    .resizable(false)
                    .build();
            }
        }
        PopupType::EyeExercise | PopupType::StretchExercise | PopupType::BreathingExercise => {
            let _ = WebviewWindowBuilder::new(app, label, url)
                .title("HealthDesk - Exercise")
                .inner_size(400.0, 350.0)
                .always_on_top(true)
                .center()
                .resizable(false)
                .build();
        }
        PopupType::WaterReminder => {
            // Bottom-right positioning
            let _ = WebviewWindowBuilder::new(app, label, url)
                .title("HealthDesk - Water")
                .inner_size(370.0, 300.0)
                .always_on_top(true)
                .resizable(false)
                .build();
        }
    }
}
