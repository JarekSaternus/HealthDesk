use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use crate::config::AppConfig;

#[cfg(windows)]
fn get_system_idle_secs() -> u64 {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::System::SystemInformation::GetTickCount;
    unsafe {
        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut lii).as_bool() {
            let now = GetTickCount();
            let idle_ms = now.wrapping_sub(lii.dwTime);
            (idle_ms / 1000) as u64
        } else {
            0
        }
    }
}

#[cfg(not(windows))]
fn get_system_idle_secs() -> u64 {
    0
}

#[cfg(windows)]
fn is_dnd_active() -> bool {
    use windows::Win32::UI::Shell::SHQueryUserNotificationState;
    unsafe {
        if let Ok(state) = SHQueryUserNotificationState() {
            // QUNS_BUSY (2) = fullscreen app, QUNS_RUNNING_D3D_FULL_SCREEN (3),
            // QUNS_PRESENTATION_MODE (4), QUNS_ACCEPTS_NOTIFICATIONS (5) = normal
            // QUNS_QUIET_TIME (6) = quiet hours / focus assist
            matches!(state.0, 2 | 3 | 4 | 6)
        } else {
            false
        }
    }
}

#[cfg(not(windows))]
fn is_dnd_active() -> bool {
    false
}

const PROTECTION_ZONE_SEC: f64 = 5.0 * 60.0;

#[derive(Debug, Clone, Serialize)]
pub struct SchedulerState {
    pub paused: bool,
    pub popup_paused: bool,
    pub outside_work_hours: bool,
    pub idle: bool,
    pub dnd: bool,
    pub time_to_small_break: f64,
    pub time_to_big_break: f64,
    pub time_to_water: f64,
    pub time_to_eye: f64,
    pub time_to_breathing: f64,
    pub include_eyes_in_big_break: bool,
}

pub struct SchedulerInner {
    pub paused: bool,
    pub pause_until: Option<Instant>,
    pub pause_start: Option<Instant>,
    pub popup_paused: bool,
    pub idle_since: Option<Instant>,
    pub last_small_break: Instant,
    pub last_big_break: Instant,
    pub last_water: Instant,
    pub last_eye: Instant,
    pub last_breathing: Instant,
    pub include_eyes_in_big_break: bool,
    pub running: bool,
}

impl SchedulerInner {
    pub fn new(last_break_elapsed_sec: Option<f64>, config: &AppConfig) -> Self {
        let now = Instant::now();
        let (last_small, last_big) = if let Some(elapsed) = last_break_elapsed_sec {
            if elapsed > 30.0 * 60.0 {
                // Long absence — fresh start
                (now, now)
            } else {
                let small_interval = config.small_break_interval_min as f64 * 60.0;
                let big_interval = config.big_break_interval_min as f64 * 60.0;
                let mut small_remaining = small_interval - elapsed;
                let mut big_remaining = big_interval - elapsed;
                if small_remaining < 0.0 {
                    small_remaining = small_interval.min(300.0);
                }
                if big_remaining < 0.0 {
                    big_remaining = big_interval.min(300.0);
                }
                (
                    now - Duration::from_secs_f64(small_interval - small_remaining),
                    now - Duration::from_secs_f64(big_interval - big_remaining),
                )
            }
        } else {
            (now, now)
        };

        Self {
            paused: false,
            pause_until: None,
            pause_start: None,
            popup_paused: false,
            idle_since: None,
            last_small_break: last_small,
            last_big_break: last_big,
            last_water: now,
            last_eye: now,
            last_breathing: now,
            include_eyes_in_big_break: false,
            running: true,
        }
    }

    pub fn pause(&mut self, minutes: u32) {
        self.paused = true;
        self.pause_start = Some(Instant::now());
        self.pause_until = Some(Instant::now() + Duration::from_secs(minutes as u64 * 60));
    }

    pub fn resume(&mut self) {
        // Shift all last_* forward by pause duration so timers continue from where they were
        if let Some(start) = self.pause_start {
            let paused_duration = start.elapsed();
            self.last_small_break += paused_duration;
            self.last_big_break += paused_duration;
            self.last_water += paused_duration;
            self.last_eye += paused_duration;
            self.last_breathing += paused_duration;
        }
        self.paused = false;
        self.pause_until = None;
        self.pause_start = None;
    }

    pub fn pause_for_popup(&mut self) {
        self.popup_paused = true;
    }

    pub fn resume_after_popup(&mut self, popup_type: Option<crate::popup_manager::PopupType>) {
        self.popup_paused = false;
        let now = Instant::now();
        match popup_type {
            Some(crate::popup_manager::PopupType::SmallBreak) => {
                self.last_small_break = now;
            }
            Some(crate::popup_manager::PopupType::BigBreak) => {
                self.last_small_break = now;
                self.last_big_break = now;
            }
            Some(crate::popup_manager::PopupType::WaterReminder) => {
                self.last_water = now;
            }
            Some(crate::popup_manager::PopupType::EyeExercise) => {
                self.last_eye = now;
            }
            Some(crate::popup_manager::PopupType::StretchExercise) => {
                // stretch comes with big break, don't reset break timers
            }
            Some(crate::popup_manager::PopupType::BreathingExercise) => {
                self.last_breathing = now;
            }
            None => {
                // fallback: reset all
                self.last_small_break = now;
                self.last_big_break = now;
                self.last_water = now;
                self.last_eye = now;
                self.last_breathing = now;
            }
        }
    }

    pub fn snooze_break(&mut self, break_type: &str, config: &AppConfig, snooze_sec: u64) {
        self.popup_paused = false;
        let now = Instant::now();
        match break_type {
            "small" => {
                let interval = config.small_break_interval_min as f64 * 60.0;
                let offset = interval - snooze_sec as f64;
                self.last_small_break = now - Duration::from_secs_f64(offset.max(0.0));
            }
            "big" => {
                let interval = config.big_break_interval_min as f64 * 60.0;
                let offset = interval - snooze_sec as f64;
                self.last_big_break = now - Duration::from_secs_f64(offset.max(0.0));
                // Also push small break so it doesn't trigger before snoozed big break
                let small_interval = config.small_break_interval_min as f64 * 60.0;
                let small_offset = small_interval - snooze_sec as f64;
                self.last_small_break = now - Duration::from_secs_f64(small_offset.max(0.0));
            }
            _ => {}
        }
    }

    fn in_work_hours(&self, config: &AppConfig) -> bool {
        if !config.work_hours_enabled {
            return true;
        }
        let now = chrono::Local::now().format("%H:%M").to_string();
        if config.work_hours_start <= config.work_hours_end {
            // Normal range: e.g. 08:00-18:00
            now >= config.work_hours_start && now <= config.work_hours_end
        } else {
            // Overnight range: e.g. 22:00-03:00
            now >= config.work_hours_start || now <= config.work_hours_end
        }
    }

    fn time_to_next(last: Instant, interval_sec: f64) -> f64 {
        interval_sec - last.elapsed().as_secs_f64()
    }

    fn time_to_next_frozen(last: Instant, interval_sec: f64, frozen_at: Instant) -> f64 {
        let elapsed = frozen_at.duration_since(last).as_secs_f64();
        interval_sec - elapsed
    }

    pub fn get_state(&self, config: &AppConfig) -> SchedulerState {
        let small_interval = config.small_break_interval_min as f64 * 60.0;
        let big_interval = config.big_break_interval_min as f64 * 60.0;
        let water_interval = config.water_interval_min as f64 * 60.0;
        let eye_interval = config.eye_exercise_interval_min as f64 * 60.0;
        let breathing_interval = config.breathing_exercise_interval_min as f64 * 60.0;
        let outside = !self.in_work_hours(config);

        // When paused or idle, show frozen timer values
        let frozen_at = self.pause_start.or(self.idle_since);
        let (t_small, t_big, t_water, t_eye, t_breathing) = if let Some(frozen) = frozen_at {
            (
                Self::time_to_next_frozen(self.last_small_break, small_interval, frozen),
                Self::time_to_next_frozen(self.last_big_break, big_interval, frozen),
                Self::time_to_next_frozen(self.last_water, water_interval, frozen),
                Self::time_to_next_frozen(self.last_eye, eye_interval, frozen),
                Self::time_to_next_frozen(self.last_breathing, breathing_interval, frozen),
            )
        } else {
            (
                Self::time_to_next(self.last_small_break, small_interval),
                Self::time_to_next(self.last_big_break, big_interval),
                Self::time_to_next(self.last_water, water_interval),
                Self::time_to_next(self.last_eye, eye_interval),
                Self::time_to_next(self.last_breathing, breathing_interval),
            )
        };

        SchedulerState {
            paused: self.paused,
            popup_paused: self.popup_paused,
            outside_work_hours: outside,
            idle: self.idle_since.is_some(),
            dnd: false, // set by scheduler loop
            time_to_small_break: t_small,
            time_to_big_break: t_big,
            time_to_water: t_water,
            time_to_eye: t_eye,
            time_to_breathing: t_breathing,
            include_eyes_in_big_break: self.include_eyes_in_big_break,
        }
    }
}

pub type SharedScheduler = Arc<Mutex<SchedulerInner>>;

pub fn start_scheduler(
    app: AppHandle,
    scheduler: SharedScheduler,
    config: Arc<Mutex<AppConfig>>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;

            let cfg = config.lock().unwrap().clone();
            let mut sched = scheduler.lock().unwrap();

            if !sched.running {
                break;
            }

            // Check pause timeout
            if sched.paused {
                if let Some(until) = sched.pause_until {
                    if Instant::now() >= until {
                        sched.resume();
                    }
                }
                let state = sched.get_state(&cfg);
                let _ = app.emit("scheduler:state-update", &state);
                continue;
            }

            if sched.popup_paused {
                let state = sched.get_state(&cfg);
                let _ = app.emit("scheduler:state-update", &state);
                continue;
            }

            // Idle detection
            if cfg.idle_detection_enabled {
                let idle_secs = get_system_idle_secs();
                let threshold_secs = cfg.idle_threshold_min as u64 * 60;

                if idle_secs >= threshold_secs && sched.idle_since.is_none() {
                    // User went idle — freeze timers
                    sched.idle_since = Some(Instant::now());
                    let _ = app.emit("scheduler:idle-detected", ());
                } else if idle_secs < threshold_secs && sched.idle_since.is_some() {
                    // User returned — reset timers (natural break happened)
                    let idle_start = sched.idle_since.unwrap();
                    let idle_duration = idle_start.elapsed();
                    sched.last_small_break += idle_duration;
                    sched.last_big_break += idle_duration;
                    sched.last_water += idle_duration;
                    sched.last_eye += idle_duration;
                    sched.last_breathing += idle_duration;
                    sched.idle_since = None;
                    let _ = app.emit("scheduler:idle-resumed", ());
                }

                if sched.idle_since.is_some() {
                    let state = sched.get_state(&cfg);
                    let _ = app.emit("scheduler:state-update", &state);
                    continue;
                }
            }

            // DND / Focus Assist detection
            let dnd = is_dnd_active();
            if dnd {
                let mut state = sched.get_state(&cfg);
                state.dnd = true;
                let _ = app.emit("scheduler:state-update", &state);
                continue;
            }

            if !sched.in_work_hours(&cfg) {
                // Reset timers so they start fresh when work hours begin
                let now = Instant::now();
                sched.last_small_break = now;
                sched.last_big_break = now;
                sched.last_water = now;
                sched.last_eye = now;
                sched.last_breathing = now;
                let state = sched.get_state(&cfg);
                let _ = app.emit("scheduler:state-update", &state);
                continue;
            }

            let small_interval = cfg.small_break_interval_min as f64 * 60.0;
            let big_interval = cfg.big_break_interval_min as f64 * 60.0;
            let water_interval = cfg.water_interval_min as f64 * 60.0;
            let eye_interval = cfg.eye_exercise_interval_min as f64 * 60.0;
            let breathing_interval = cfg.breathing_exercise_interval_min as f64 * 60.0;

            let time_to_small = SchedulerInner::time_to_next(sched.last_small_break, small_interval);
            let time_to_big = SchedulerInner::time_to_next(sched.last_big_break, big_interval);
            let time_to_eye = SchedulerInner::time_to_next(sched.last_eye, eye_interval);
            let time_to_breathing = SchedulerInner::time_to_next(sched.last_breathing, breathing_interval);
            let time_to_water = SchedulerInner::time_to_next(sched.last_water, water_interval);
            let now = Instant::now();

            // Big break
            if time_to_big <= 0.0 {
                sched.last_big_break = now;
                sched.last_small_break = now;

                if time_to_eye <= PROTECTION_ZONE_SEC {
                    sched.include_eyes_in_big_break = true;
                    sched.last_eye = now;
                }

                let state = sched.get_state(&cfg);
                let _ = app.emit("scheduler:state-update", &state);
                drop(sched);
                let _ = app.emit("scheduler:big-break", ());
                continue;
            }

            // Small break
            if time_to_small <= 0.0 {
                if time_to_big <= PROTECTION_ZONE_SEC {
                    sched.last_small_break = now;
                    continue;
                }
                sched.last_small_break = now;
                let state = sched.get_state(&cfg);
                let _ = app.emit("scheduler:state-update", &state);
                drop(sched);
                let _ = app.emit("scheduler:small-break", ());
                continue;
            }

            // Eye exercise
            if time_to_eye <= 0.0 {
                if time_to_small <= PROTECTION_ZONE_SEC && time_to_small > 0.0 {
                    continue;
                }
                if time_to_big <= PROTECTION_ZONE_SEC {
                    continue;
                }
                sched.last_eye = now;
                let state = sched.get_state(&cfg);
                let _ = app.emit("scheduler:state-update", &state);
                drop(sched);
                let _ = app.emit("scheduler:eye-exercise", ());
                continue;
            }

            // Breathing exercise
            if cfg.breathing_exercise_enabled && time_to_breathing <= 0.0 {
                if time_to_small <= PROTECTION_ZONE_SEC && time_to_small > 0.0 {
                    continue;
                }
                if time_to_big <= PROTECTION_ZONE_SEC {
                    continue;
                }
                sched.last_breathing = now;
                let state = sched.get_state(&cfg);
                let _ = app.emit("scheduler:state-update", &state);
                drop(sched);
                let _ = app.emit("scheduler:breathing-exercise", ());
                continue;
            }

            // Water reminder
            if time_to_water <= 0.0 {
                if time_to_small <= PROTECTION_ZONE_SEC && time_to_small > 0.0 {
                    continue;
                }
                if time_to_big <= PROTECTION_ZONE_SEC && time_to_big > 0.0 {
                    continue;
                }
                sched.last_water = now;
                let state = sched.get_state(&cfg);
                let _ = app.emit("scheduler:state-update", &state);
                drop(sched);
                let _ = app.emit("scheduler:water-reminder", ());
                continue;
            }

            // Regular state update
            let state = sched.get_state(&cfg);
            let _ = app.emit("scheduler:state-update", &state);
        }
    });
}
