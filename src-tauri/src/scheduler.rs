use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use crate::config::AppConfig;

const PROTECTION_ZONE_SEC: f64 = 5.0 * 60.0;

#[derive(Debug, Clone, Serialize)]
pub struct SchedulerState {
    pub paused: bool,
    pub popup_paused: bool,
    pub outside_work_hours: bool,
    pub time_to_small_break: f64,
    pub time_to_big_break: f64,
    pub time_to_water: f64,
    pub time_to_eye: f64,
    pub include_eyes_in_big_break: bool,
}

pub struct SchedulerInner {
    pub paused: bool,
    pub pause_until: Option<Instant>,
    pub pause_start: Option<Instant>,
    pub popup_paused: bool,
    pub last_small_break: Instant,
    pub last_big_break: Instant,
    pub last_water: Instant,
    pub last_eye: Instant,
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
            last_small_break: last_small,
            last_big_break: last_big,
            last_water: now,
            last_eye: now,
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
        }
        self.paused = false;
        self.pause_until = None;
        self.pause_start = None;
    }

    pub fn pause_for_popup(&mut self) {
        self.popup_paused = true;
    }

    pub fn resume_after_popup(&mut self) {
        self.popup_paused = false;
        let now = Instant::now();
        self.last_small_break = now;
        self.last_big_break = now;
        self.last_water = now;
        self.last_eye = now;
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
        let outside = !self.in_work_hours(config);

        // When paused, show frozen timer values from pause_start moment
        let (t_small, t_big, t_water, t_eye) = if let Some(frozen) = self.pause_start {
            (
                Self::time_to_next_frozen(self.last_small_break, small_interval, frozen),
                Self::time_to_next_frozen(self.last_big_break, big_interval, frozen),
                Self::time_to_next_frozen(self.last_water, water_interval, frozen),
                Self::time_to_next_frozen(self.last_eye, eye_interval, frozen),
            )
        } else {
            (
                Self::time_to_next(self.last_small_break, small_interval),
                Self::time_to_next(self.last_big_break, big_interval),
                Self::time_to_next(self.last_water, water_interval),
                Self::time_to_next(self.last_eye, eye_interval),
            )
        };

        SchedulerState {
            paused: self.paused,
            popup_paused: self.popup_paused,
            outside_work_hours: outside,
            time_to_small_break: t_small,
            time_to_big_break: t_big,
            time_to_water: t_water,
            time_to_eye: t_eye,
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

            if !sched.in_work_hours(&cfg) {
                // Reset timers so they start fresh when work hours begin
                let now = Instant::now();
                sched.last_small_break = now;
                sched.last_big_break = now;
                sched.last_water = now;
                sched.last_eye = now;
                let state = sched.get_state(&cfg);
                let _ = app.emit("scheduler:state-update", &state);
                continue;
            }

            let small_interval = cfg.small_break_interval_min as f64 * 60.0;
            let big_interval = cfg.big_break_interval_min as f64 * 60.0;
            let water_interval = cfg.water_interval_min as f64 * 60.0;
            let eye_interval = cfg.eye_exercise_interval_min as f64 * 60.0;

            let time_to_small = SchedulerInner::time_to_next(sched.last_small_break, small_interval);
            let time_to_big = SchedulerInner::time_to_next(sched.last_big_break, big_interval);
            let time_to_eye = SchedulerInner::time_to_next(sched.last_eye, eye_interval);
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
