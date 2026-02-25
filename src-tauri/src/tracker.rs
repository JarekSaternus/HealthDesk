use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::config::AppConfig;
use crate::database::Database;

fn category_map() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    // Work
    for app in &[
        "code.exe", "devenv.exe", "idea64.exe", "pycharm64.exe", "webstorm64.exe",
        "rider64.exe", "goland64.exe", "clion64.exe", "datagrip64.exe",
        "sublime_text.exe", "notepad++.exe", "atom.exe",
        "winword.exe", "excel.exe", "powerpnt.exe", "onenote.exe",
        "outlook.exe", "thunderbird.exe",
        "windowsterminal.exe", "cmd.exe", "powershell.exe", "pwsh.exe",
        "mintty.exe", "conemu64.exe", "wt.exe",
        "figma.exe", "adobe photoshop.exe", "illustrator.exe",
    ] {
        m.insert(*app, "Work");
    }
    // Entertainment
    for app in &[
        "spotify.exe", "vlc.exe", "wmplayer.exe", "itunes.exe",
        "steam.exe", "epicgameslauncher.exe", "gog galaxy.exe",
        "netflix.exe", "twitch.exe",
    ] {
        m.insert(*app, "Entertainment");
    }
    // Communication
    for app in &[
        "teams.exe", "ms-teams.exe", "slack.exe", "discord.exe",
        "zoom.exe", "skype.exe", "telegram.exe", "signal.exe",
        "whatsapp.exe", "messenger.exe",
    ] {
        m.insert(*app, "Communication");
    }
    // Browser
    for app in &[
        "chrome.exe", "firefox.exe", "msedge.exe", "opera.exe",
        "brave.exe", "vivaldi.exe", "safari.exe", "iexplore.exe",
    ] {
        m.insert(*app, "Browser");
    }
    m
}

fn browser_title_category(title: &str) -> Option<&'static str> {
    let lower = title.to_lowercase();
    if lower.contains("youtube") || lower.contains("netflix") || lower.contains("twitch") {
        return Some("Entertainment");
    }
    if lower.contains("gmail") || lower.contains("outlook") || lower.contains("slack")
        || lower.contains("teams") || lower.contains("discord")
    {
        return Some("Communication");
    }
    if lower.contains("github") || lower.contains("gitlab") || lower.contains("stackoverflow")
        || lower.contains("docs.") || lower.contains("jira") || lower.contains("confluence")
    {
        return Some("Work");
    }
    None
}

#[cfg(windows)]
mod platform {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::Foundation::CloseHandle;
    use windows::core::PWSTR;

    pub fn get_foreground_info() -> Option<(String, String)> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }

            // Get window title
            let mut title_buf = [0u16; 512];
            let title_len = GetWindowTextW(hwnd, &mut title_buf);
            let title = if title_len > 0 {
                String::from_utf16_lossy(&title_buf[..title_len as usize])
            } else {
                String::new()
            };

            // Get process name
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return Some(("unknown".into(), title));
            }

            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut name_buf = [0u16; 1024];
                let mut size = name_buf.len() as u32;
                if QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_FORMAT(0),
                    PWSTR(name_buf.as_mut_ptr()),
                    &mut size,
                ).is_ok() {
                    let _ = CloseHandle(handle);
                    let full_path = String::from_utf16_lossy(&name_buf[..size as usize]);
                    let exe_name = full_path
                        .rsplit('\\')
                        .next()
                        .unwrap_or("unknown")
                        .to_lowercase();
                    return Some((exe_name, title));
                }
                let _ = CloseHandle(handle);
            }
            Some(("unknown".into(), title))
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn get_foreground_info() -> Option<(String, String)> {
        None // Not implemented for non-Windows
    }
}

pub fn start_tracker(db: Arc<Database>, config: Arc<Mutex<AppConfig>>) {
    let categories = category_map();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;

            if let Some((process_name, window_title)) = platform::get_foreground_info() {
                let category = if let Some(&cat) = categories.get(process_name.as_str()) {
                    if cat == "Browser" {
                        browser_title_category(&window_title).unwrap_or("Browser")
                    } else {
                        cat
                    }
                } else {
                    "Other"
                };

                let cfg = config.lock().unwrap();
                let title = if cfg.track_window_titles {
                    window_title.clone()
                } else {
                    String::new()
                };
                drop(cfg);

                let conn = db.0.lock().unwrap();
                let _ = crate::database::log_activity(&conn, &process_name, &title, 5, category);
            }
        }
    });
}
