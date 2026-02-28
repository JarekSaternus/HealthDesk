use rand::Rng;
use serde::Serialize;
use std::process::{Child, Command};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize)]
pub struct YTStation {
    pub key: String,
    pub name: String,
    pub query: String,
}

pub fn preset_stations() -> Vec<YTStation> {
    vec![
        YTStation { key: "lofi".into(), name: "Lofi Girl".into(), query: "lofi hip hop radio beats to relax/study to".into() },
        YTStation { key: "jazz".into(), name: "Jazz Cafe".into(), query: "jazz cafe smooth jazz bossa nova radio".into() },
        YTStation { key: "classical".into(), name: "Classical Focus".into(), query: "classical music for studying and concentration".into() },
        YTStation { key: "synthwave".into(), name: "Synthwave Radio".into(), query: "synthwave radio instrumental".into() },
        YTStation { key: "piano".into(), name: "Piano & Ambient".into(), query: "calm piano ambient music for focus".into() },
        YTStation { key: "chillhop".into(), name: "Chillhop Radio".into(), query: "chillhop radio beats chill study music".into() },
    ]
}

#[derive(Debug, Clone, Serialize)]
pub struct RadioStation {
    pub key: String,
    pub name: String,
    pub url: String,
}

pub fn preset_radio_stations() -> Vec<RadioStation> {
    vec![
        RadioStation { key: "rmf_fm".into(), name: "RMF FM".into(), url: "https://rs6-krk2.rmfstream.pl/RMFFM48".into() },
        RadioStation { key: "rmf_maxx".into(), name: "RMF MAXX".into(), url: "https://rs6-krk2.rmfstream.pl/rmf_maxxx".into() },
        RadioStation { key: "antyradio".into(), name: "Antyradio".into(), url: "http://an.cdn.eurozet.pl/ant-web.mp3".into() },
        RadioStation { key: "radio_zet".into(), name: "Radio ZET".into(), url: "http://zt.cdn.eurozet.pl/zet-net.mp3".into() },
        RadioStation { key: "eska".into(), name: "Radio Eska".into(), url: "https://ic2.smcdn.pl/6140-1.mp3".into() },
        RadioStation { key: "chillizet".into(), name: "Chillizet".into(), url: "http://ch.cdn.eurozet.pl/chi-net.mp3".into() },
    ]
}

pub struct YouTubePlayer {
    ffplay_process: Mutex<Option<Child>>,
    current_station: Mutex<Option<String>>,
    current_url: Mutex<Option<String>>,
    current_volume: Mutex<u32>,
    paused_station: Mutex<Option<String>>,
    paused_url: Mutex<Option<String>>,
}

impl YouTubePlayer {
    pub fn new() -> Self {
        Self {
            ffplay_process: Mutex::new(None),
            current_station: Mutex::new(None),
            current_url: Mutex::new(None),
            current_volume: Mutex::new(50),
            paused_station: Mutex::new(None),
            paused_url: Mutex::new(None),
        }
    }

    pub fn play_url(&self, url: &str, station_name: &str, volume: u32) -> Result<(), String> {
        self.stop();

        // Use yt-dlp to get audio URL
        let mut cmd = Command::new("yt-dlp");
        cmd.args(["--get-url", "-f", "bestaudio", "--no-playlist", url]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd.output()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        if !output.status.success() {
            return Err("yt-dlp failed to extract URL".into());
        }

        let audio_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if audio_url.is_empty() {
            return Err("No audio URL extracted".into());
        }

        let vol = (volume as f32 / 100.0 * 256.0) as u32;
        let mut ffcmd = Command::new("ffplay");
        ffcmd.args([
                "-nodisp", "-autoexit", "-loglevel", "quiet",
                "-volume", &vol.to_string(),
                &audio_url,
            ]);
        #[cfg(target_os = "windows")]
        ffcmd.creation_flags(CREATE_NO_WINDOW);
        let child = ffcmd.spawn()
            .map_err(|e| format!("ffplay not found: {}", e))?;

        *self.ffplay_process.lock().unwrap() = Some(child);
        *self.current_station.lock().unwrap() = Some(station_name.to_string());
        *self.current_url.lock().unwrap() = Some(audio_url);
        *self.current_volume.lock().unwrap() = volume;
        Ok(())
    }

    pub fn play_stream(&self, url: &str, station_name: &str, volume: u32) -> Result<(), String> {
        self.stop();

        let vol = (volume as f32 / 100.0 * 256.0) as u32;
        let mut ffcmd = Command::new("ffplay");
        ffcmd.args([
            "-nodisp", "-autoexit", "-loglevel", "quiet",
            "-volume", &vol.to_string(),
            url,
        ]);
        #[cfg(target_os = "windows")]
        ffcmd.creation_flags(CREATE_NO_WINDOW);
        let child = ffcmd.spawn()
            .map_err(|e| format!("ffplay not found: {}", e))?;

        *self.ffplay_process.lock().unwrap() = Some(child);
        *self.current_station.lock().unwrap() = Some(station_name.to_string());
        *self.current_url.lock().unwrap() = Some(url.to_string());
        *self.current_volume.lock().unwrap() = volume;
        Ok(())
    }

    pub fn play_search(&self, query: &str, volume: u32) -> Result<(), String> {
        let results = search_youtube(query)?;
        if results.is_empty() {
            return Err("No results found".into());
        }
        let pick = rand::rng().random_range(0..results.len().min(5));
        let chosen = &results[pick];
        self.play_url(&chosen.url, &chosen.title, volume)
    }

    pub fn stop(&self) {
        let mut proc = self.ffplay_process.lock().unwrap();
        if let Some(ref mut child) = *proc {
            let _ = child.kill();
            let _ = child.wait();
        }
        *proc = None;
        *self.current_station.lock().unwrap() = None;
        *self.current_url.lock().unwrap() = None;
        *self.paused_station.lock().unwrap() = None;
        *self.paused_url.lock().unwrap() = None;
    }

    pub fn pause_playback(&self) {
        if !self.is_playing() {
            return;
        }
        let station = self.current_station.lock().unwrap().clone();
        let url = self.current_url.lock().unwrap().clone();
        *self.paused_station.lock().unwrap() = station;
        *self.paused_url.lock().unwrap() = url;
        // Kill ffplay but keep paused state
        let mut proc = self.ffplay_process.lock().unwrap();
        if let Some(ref mut child) = *proc {
            let _ = child.kill();
            let _ = child.wait();
        }
        *proc = None;
        *self.current_station.lock().unwrap() = None;
        *self.current_url.lock().unwrap() = None;
    }

    pub fn resume_playback(&self) -> Result<(), String> {
        let station = self.paused_station.lock().unwrap().take();
        let url = self.paused_url.lock().unwrap().take();
        if let (Some(audio_url), Some(station_name)) = (url, station) {
            let volume = *self.current_volume.lock().unwrap();
            let vol = (volume as f32 / 100.0 * 256.0) as u32;
            let mut ffcmd = Command::new("ffplay");
            ffcmd.args([
                "-nodisp", "-autoexit", "-loglevel", "quiet",
                "-volume", &vol.to_string(),
                &audio_url,
            ]);
            #[cfg(target_os = "windows")]
            ffcmd.creation_flags(CREATE_NO_WINDOW);
            let child = ffcmd.spawn()
                .map_err(|e| format!("ffplay not found: {}", e))?;
            *self.ffplay_process.lock().unwrap() = Some(child);
            *self.current_station.lock().unwrap() = Some(station_name);
            *self.current_url.lock().unwrap() = Some(audio_url);
        }
        Ok(())
    }

    pub fn is_paused(&self) -> bool {
        self.paused_url.lock().unwrap().is_some()
    }

    pub fn is_playing(&self) -> bool {
        let mut proc = self.ffplay_process.lock().unwrap();
        if let Some(ref mut child) = *proc {
            match child.try_wait() {
                Ok(Some(_)) => {
                    *proc = None;
                    false
                }
                _ => true,
            }
        } else {
            false
        }
    }

    pub fn current_station(&self) -> Option<String> {
        self.current_station.lock().unwrap().clone()
    }

    pub fn set_volume(&self, volume: u32) {
        *self.current_volume.lock().unwrap() = volume;
        let url = self.current_url.lock().unwrap().clone();
        if let Some(audio_url) = url {
            // Kill current ffplay
            let mut proc = self.ffplay_process.lock().unwrap();
            if let Some(ref mut child) = *proc {
                let _ = child.kill();
                let _ = child.wait();
            }
            // Restart with new volume
            let vol = (volume as f32 / 100.0 * 256.0) as u32;
            let mut ffcmd = Command::new("ffplay");
            ffcmd.args([
                "-nodisp", "-autoexit", "-loglevel", "quiet",
                "-volume", &vol.to_string(),
                &audio_url,
            ]);
            #[cfg(target_os = "windows")]
            ffcmd.creation_flags(CREATE_NO_WINDOW);
            if let Ok(child) = ffcmd.spawn() {
                *proc = Some(child);
            }
        }
    }
}

impl Drop for YouTubePlayer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Kill any orphaned ffplay processes left from a previous run
pub fn kill_orphan_ffplay() {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/F", "/IM", "ffplay.exe"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("pkill").arg("ffplay").output();
    }
}

#[derive(Debug, Serialize)]
pub struct YTSearchResult {
    pub title: String,
    pub url: String,
    pub duration: String,
    pub channel: String,
}

pub fn search_youtube(query: &str) -> Result<Vec<YTSearchResult>, String> {
    let mut cmd = Command::new("yt-dlp");
    cmd.args(["--dump-json", "--flat-playlist", &format!("ytsearch15:{}", query)]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output()
        .map_err(|e| format!("yt-dlp not found: {}", e))?;

    if !output.status.success() {
        return Err("Search failed".into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            results.push(YTSearchResult {
                title: json["title"].as_str().unwrap_or("").to_string(),
                url: format!("https://www.youtube.com/watch?v={}", json["id"].as_str().unwrap_or("")),
                duration: format_duration(json["duration"].as_f64().unwrap_or(0.0)),
                channel: json["channel"].as_str().or(json["uploader"].as_str()).unwrap_or("").to_string(),
            });
        }
    }

    Ok(results)
}

fn format_duration(secs: f64) -> String {
    let s = secs as u64;
    let m = s / 60;
    let sec = s % 60;
    format!("{}:{:02}", m, sec)
}
