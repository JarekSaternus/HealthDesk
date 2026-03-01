use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::config;

const API_HOST: &str = "https://api.healthdesk.site";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ad {
    pub title: String,
    pub description: String,
    pub image_url: String,
    pub click_url: String,
    pub bg_color: String,
    pub text_color: String,
    pub ad_id: String,
}

fn cache_path() -> PathBuf {
    config::config_dir().join("ads_cache.json")
}

fn fallback_ads(lang: &str) -> Vec<Ad> {
    let is_pl = lang.starts_with("pl");
    vec![
        Ad {
            title: "HealthDesk Pro".into(),
            description: if is_pl {
                "Ulepsz do wersji z zaawansowanymi funkcjami".into()
            } else {
                "Upgrade for advanced features".into()
            },
            image_url: String::new(),
            click_url: "https://healthdesk.app/pro".into(),
            bg_color: "#1a1f2b".into(),
            text_color: "#ffffff".into(),
            ad_id: "fallback_1".into(),
        },
        Ad {
            title: if is_pl { "Dbaj o zdrowie".into() } else { "Stay Healthy".into() },
            description: if is_pl {
                "Rób regularne przerwy dla lepszego zdrowia".into()
            } else {
                "Take regular breaks for better health".into()
            },
            image_url: String::new(),
            click_url: "https://healthdesk.app".into(),
            bg_color: "#1a1f2b".into(),
            text_color: "#ffffff".into(),
            ad_id: "fallback_2".into(),
        },
        Ad {
            title: if is_pl { "Dbaj o wzrok".into() } else { "Eye Care Tips".into() },
            description: if is_pl {
                "Stosuj zasadę 20-20-20 każdego dnia".into()
            } else {
                "Follow the 20-20-20 rule daily".into()
            },
            image_url: String::new(),
            click_url: "https://healthdesk.app/tips".into(),
            bg_color: "#1a1f2b".into(),
            text_color: "#ffffff".into(),
            ad_id: "fallback_3".into(),
        },
    ]
}

fn is_valid_hex_color(s: &str) -> bool {
    s.len() == 7
        && s.starts_with('#')
        && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn sanitize_url(url: &str) -> String {
    if url.starts_with("https://") || url.starts_with("http://") {
        html_escape(url)
    } else {
        String::new()
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

fn sanitize_ad(ad: &mut Ad) {
    ad.title = html_escape(&ad.title);
    ad.description = html_escape(&ad.description);
    ad.image_url = sanitize_url(&ad.image_url);
    ad.click_url = sanitize_url(&ad.click_url);
    if !is_valid_hex_color(&ad.bg_color) {
        ad.bg_color = "#1a1f2b".into();
    }
    if !is_valid_hex_color(&ad.text_color) {
        ad.text_color = "#ffffff".into();
    }
}

pub async fn fetch_ad(client_uuid: &str, lang: &str) -> Ad {
    // Try remote
    if let Ok(mut ad) = fetch_remote(client_uuid).await {
        sanitize_ad(&mut ad);
        // Cache it
        let _ = save_cache(&ad);
        return ad;
    }

    // Try cache
    if let Some(mut ad) = load_cache() {
        sanitize_ad(&mut ad);
        return ad;
    }

    // Fallback
    let mut ads = fallback_ads(lang);
    let idx = rand::random_range(0..ads.len());
    let mut ad = ads.remove(idx);
    sanitize_ad(&mut ad);
    ad
}

async fn fetch_remote(client_uuid: &str) -> Result<Ad, String> {
    let url = format!("{}/api/ads/get?client_id={}&platform=desktop", API_HOST, client_uuid);
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let ad: Ad = resp.json().await.map_err(|e| e.to_string())?;
    Ok(ad)
}

fn save_cache(ad: &Ad) -> Result<(), String> {
    let path = cache_path();
    let json = serde_json::to_string_pretty(ad).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn load_cache() -> Option<Ad> {
    let path = cache_path();
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

pub async fn report_click(ad_id: &str, client_uuid: &str) {
    let url = format!("{}/api/ads/click", API_HOST);
    let body = serde_json::json!({
        "ad_id": ad_id,
        "client_id": client_uuid,
    });
    let _ = reqwest::Client::new().post(&url).json(&body).send().await;
}
