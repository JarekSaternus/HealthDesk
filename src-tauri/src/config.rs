use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_work_method")]
    pub work_method: String,
    #[serde(default = "default_small_break_interval")]
    pub small_break_interval_min: u32,
    #[serde(default = "default_small_break_duration")]
    pub small_break_duration_sec: u32,
    #[serde(default = "default_big_break_interval")]
    pub big_break_interval_min: u32,
    #[serde(default = "default_big_break_duration")]
    pub big_break_duration_min: u32,
    #[serde(default = "default_break_mode")]
    pub break_mode: String,
    #[serde(default = "default_water_interval")]
    pub water_interval_min: u32,
    #[serde(default = "default_water_goal")]
    pub water_daily_goal: u32,
    #[serde(default = "default_eye_interval")]
    pub eye_exercise_interval_min: u32,
    #[serde(default = "default_work_hours_start")]
    pub work_hours_start: String,
    #[serde(default = "default_work_hours_end")]
    pub work_hours_end: String,
    #[serde(default)]
    pub work_hours_enabled: bool,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default = "default_true")]
    pub sound_notifications: bool,
    #[serde(default = "default_true")]
    pub show_ads: bool,
    #[serde(default = "default_true")]
    pub telemetry_enabled: bool,
    #[serde(default)]
    pub track_window_titles: bool,
    #[serde(default = "default_true")]
    pub audio_autoplay: bool,
    #[serde(default)]
    pub audio_last_source: Option<String>,
    #[serde(default)]
    pub audio_last_type: Option<String>,
    #[serde(default = "default_volume")]
    pub audio_last_volume: u32,
    #[serde(default = "default_lang")]
    pub language: String,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default = "default_dashboard_layout")]
    pub dashboard_layout: String,
}

fn default_work_method() -> String { "pomodoro".into() }
fn default_small_break_interval() -> u32 { 25 }
fn default_small_break_duration() -> u32 { 300 }
fn default_big_break_interval() -> u32 { 100 }
fn default_big_break_duration() -> u32 { 15 }
fn default_break_mode() -> String { "moderate".into() }
fn default_water_interval() -> u32 { 30 }
fn default_water_goal() -> u32 { 8 }
fn default_eye_interval() -> u32 { 25 }
fn default_work_hours_start() -> String { "08:00".into() }
fn default_work_hours_end() -> String { "18:00".into() }
fn default_true() -> bool { true }
fn default_volume() -> u32 { 10 }
fn default_lang() -> String { "pl".into() }
fn default_dashboard_layout() -> String { "enhanced".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkMethodPreset {
    pub small_break_interval_min: u32,
    pub small_break_duration_sec: u32,
    pub big_break_interval_min: u32,
    pub big_break_duration_min: u32,
    pub eye_exercise_interval_min: u32,
}

pub fn work_methods() -> HashMap<String, WorkMethodPreset> {
    let mut m = HashMap::new();
    m.insert("pomodoro".into(), WorkMethodPreset {
        small_break_interval_min: 25,
        small_break_duration_sec: 300,
        big_break_interval_min: 100,
        big_break_duration_min: 15,
        eye_exercise_interval_min: 25,
    });
    m.insert("20-20-20".into(), WorkMethodPreset {
        small_break_interval_min: 20,
        small_break_duration_sec: 20,
        big_break_interval_min: 60,
        big_break_duration_min: 5,
        eye_exercise_interval_min: 30,
    });
    m.insert("52-17".into(), WorkMethodPreset {
        small_break_interval_min: 52,
        small_break_duration_sec: 1020,
        big_break_interval_min: 52,
        big_break_duration_min: 17,
        eye_exercise_interval_min: 52,
    });
    m.insert("90-min".into(), WorkMethodPreset {
        small_break_interval_min: 90,
        small_break_duration_sec: 300,
        big_break_interval_min: 270,
        big_break_duration_min: 20,
        eye_exercise_interval_min: 30,
    });
    m
}

pub fn config_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("HealthDesk")
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

pub fn db_path() -> PathBuf {
    config_dir().join("healthdesk.db")
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(mut cfg) = serde_json::from_str::<AppConfig>(&data) {
                enforce_preset(&mut cfg);
                return cfg;
            }
        }
    }
    // First launch: check installer language file, then system locale
    let mut cfg = AppConfig::default();
    let lang_file = config_dir().join("installer_lang.txt");
    if lang_file.exists() {
        if let Ok(lang) = fs::read_to_string(&lang_file) {
            let lang = lang.trim().to_lowercase();
            if lang == "en" || lang == "english" {
                cfg.language = "en".into();
            }
        }
    } else {
        // Detect system locale
        cfg.language = detect_system_language();
    }
    cfg
}

pub fn save_config(cfg: &AppConfig) -> Result<(), String> {
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(), json).map_err(|e| e.to_string())?;
    Ok(())
}

fn enforce_preset(cfg: &mut AppConfig) {
    let methods = work_methods();
    if cfg.work_method != "custom" {
        if let Some(preset) = methods.get(&cfg.work_method) {
            cfg.small_break_interval_min = preset.small_break_interval_min;
            cfg.small_break_duration_sec = preset.small_break_duration_sec;
            cfg.big_break_interval_min = preset.big_break_interval_min;
            cfg.big_break_duration_min = preset.big_break_duration_min;
            cfg.eye_exercise_interval_min = preset.eye_exercise_interval_min;
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            work_method: "pomodoro".into(),
            small_break_interval_min: 25,
            small_break_duration_sec: 300,
            big_break_interval_min: 100,
            big_break_duration_min: 15,
            break_mode: "moderate".into(),
            water_interval_min: 30,
            water_daily_goal: 8,
            eye_exercise_interval_min: 25,
            work_hours_start: "08:00".into(),
            work_hours_end: "18:00".into(),
            work_hours_enabled: false,
            autostart: false,
            sound_notifications: true,
            show_ads: true,
            telemetry_enabled: true,
            track_window_titles: false,
            audio_autoplay: true,
            audio_last_source: None,
            audio_last_type: None,
            audio_last_volume: 10,
            language: "pl".into(),
            auto_update: true,
            dashboard_layout: "enhanced".into(),
        }
    }
}

fn detect_system_language() -> String {
    // Check LANG, LC_ALL, LC_MESSAGES env vars first (cross-platform)
    for var in &["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(val) = std::env::var(var) {
            let lower = val.to_lowercase();
            if lower.starts_with("pl") { return "pl".into(); }
            if lower.starts_with("en") { return "en".into(); }
        }
    }
    // On Windows, check via system locale name
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", "(Get-Culture).TwoLetterISOLanguageName"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        if let Ok(output) = cmd.output()
        {
            let lang = String::from_utf8_lossy(&output.stdout).trim().to_lowercase();
            if lang == "pl" { return "pl".into(); }
            if lang == "en" { return "en".into(); }
        }
    }
    "en".into()
}

pub struct ConfigState(pub Mutex<AppConfig>);
