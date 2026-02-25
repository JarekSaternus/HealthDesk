use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;

use crate::config;

pub struct I18n {
    translations: Mutex<HashMap<String, Value>>,
    current_lang: Mutex<String>,
}

impl I18n {
    pub fn new(lang: &str) -> Self {
        let i18n = Self {
            translations: Mutex::new(HashMap::new()),
            current_lang: Mutex::new(lang.to_string()),
        };
        i18n.load_language(lang);
        i18n
    }

    pub fn load_language(&self, lang: &str) {
        *self.current_lang.lock().unwrap() = lang.to_string();

        // Load bundled locale
        let bundled = self.load_bundled(lang).unwrap_or_default();

        // Load user overlay from %APPDATA%/HealthDesk/locales/
        let overlay = self.load_user_overlay(lang).unwrap_or_default();

        // Deep merge: overlay wins
        let merged = deep_merge(bundled, overlay);

        *self.translations.lock().unwrap() = flatten_json(&merged, "");
    }

    fn load_bundled(&self, lang: &str) -> Option<Value> {
        // Try to load from executable directory first, then from locales/
        let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        let paths = [
            exe_dir.join("locales").join(format!("{}.json", lang)),
            exe_dir.join("_internal").join("locales").join(format!("{}.json", lang)),
            std::env::current_dir().ok()?.join("locales").join(format!("{}.json", lang)),
        ];

        for path in &paths {
            if let Ok(data) = fs::read_to_string(path) {
                if let Ok(val) = serde_json::from_str(&data) {
                    return Some(val);
                }
            }
        }

        // Fallback: try embedded
        let embedded = match lang {
            "pl" => include_str!("../../locales/pl.json"),
            "en" => include_str!("../../locales/en.json"),
            _ => include_str!("../../locales/en.json"),
        };
        serde_json::from_str(embedded).ok()
    }

    fn load_user_overlay(&self, lang: &str) -> Option<Value> {
        let path = config::config_dir()
            .join("locales")
            .join(format!("{}.json", lang));
        let data = fs::read_to_string(path).ok()?;
        serde_json::from_str(&data).ok()
    }

    pub fn get_all(&self) -> Value {
        let trans = self.translations.lock().unwrap();
        // Reconstruct nested JSON from flat map
        let mut root = serde_json::Map::new();
        for (key, val) in trans.iter() {
            set_nested(&mut root, key, val.clone());
        }
        Value::Object(root)
    }

    pub fn t(&self, key: &str) -> String {
        let trans = self.translations.lock().unwrap();
        if let Some(val) = trans.get(key) {
            if let Some(s) = val.as_str() {
                return s.to_string();
            }
            return val.to_string();
        }
        key.to_string()
    }
}

fn deep_merge(base: Value, overlay: Value) -> Value {
    match (base, overlay) {
        (Value::Object(mut b), Value::Object(o)) => {
            for (k, v) in o {
                let merged = if let Some(existing) = b.remove(&k) {
                    deep_merge(existing, v)
                } else {
                    v
                };
                b.insert(k, merged);
            }
            Value::Object(b)
        }
        (_, overlay) => overlay,
    }
}

fn flatten_json(val: &Value, prefix: &str) -> HashMap<String, Value> {
    let mut map = HashMap::new();
    match val {
        Value::Object(obj) => {
            for (k, v) in obj {
                let key = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{}.{}", prefix, k)
                };
                match v {
                    Value::Object(_) => {
                        map.extend(flatten_json(v, &key));
                    }
                    _ => {
                        map.insert(key, v.clone());
                    }
                }
            }
        }
        _ => {
            if !prefix.is_empty() {
                map.insert(prefix.to_string(), val.clone());
            }
        }
    }
    map
}

fn set_nested(root: &mut serde_json::Map<String, Value>, key: &str, val: Value) {
    let parts: Vec<&str> = key.splitn(2, '.').collect();
    if parts.len() == 1 {
        root.insert(parts[0].to_string(), val);
    } else {
        let entry = root
            .entry(parts[0].to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if let Value::Object(ref mut obj) = entry {
            set_nested(obj, parts[1], val);
        }
    }
}
