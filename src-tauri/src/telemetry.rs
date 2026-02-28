use serde::Serialize;
use std::sync::Arc;
use tokio::sync::mpsc;

const API_HOST: &str = "https://api.healthdesk.site";
const BATCH_SIZE: usize = 10;
const FLUSH_INTERVAL_SEC: u64 = 30;

#[derive(Debug, Clone, Serialize)]
pub struct TelemetryEvent {
    pub event_type: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

pub struct TelemetryEngine {
    tx: mpsc::UnboundedSender<TelemetryEvent>,
    enabled: Arc<std::sync::atomic::AtomicBool>,
}

impl TelemetryEngine {
    pub fn new(client_uuid: String, enabled: bool) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let enabled_flag = Arc::new(std::sync::atomic::AtomicBool::new(enabled));
        let flag_clone = enabled_flag.clone();

        tauri::async_runtime::spawn(async move {
            telemetry_worker(rx, client_uuid, flag_clone).await;
        });

        Self { tx, enabled: enabled_flag }
    }

    pub fn track(&self, event_type: &str, data: Option<serde_json::Value>) {
        if !self.enabled.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let event = TelemetryEvent {
            event_type: event_type.to_string(),
            timestamp: chrono::Local::now().to_rfc3339(),
            data,
        };
        let _ = self.tx.send(event);
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, std::sync::atomic::Ordering::Relaxed);
    }
}

async fn telemetry_worker(
    mut rx: mpsc::UnboundedReceiver<TelemetryEvent>,
    client_uuid: String,
    enabled: Arc<std::sync::atomic::AtomicBool>,
) {
    let client = reqwest::Client::new();
    let mut batch: Vec<TelemetryEvent> = Vec::new();

    loop {
        let flush_timeout = tokio::time::sleep(std::time::Duration::from_secs(FLUSH_INTERVAL_SEC));
        tokio::pin!(flush_timeout);

        tokio::select! {
            Some(event) = rx.recv() => {
                batch.push(event);
                if batch.len() >= BATCH_SIZE {
                    send_batch(&client, &client_uuid, &mut batch, &enabled).await;
                }
            }
            _ = &mut flush_timeout => {
                if !batch.is_empty() {
                    send_batch(&client, &client_uuid, &mut batch, &enabled).await;
                }
            }
        }
    }
}

async fn send_batch(
    client: &reqwest::Client,
    client_uuid: &str,
    batch: &mut Vec<TelemetryEvent>,
    enabled: &std::sync::atomic::AtomicBool,
) {
    if !enabled.load(std::sync::atomic::Ordering::Relaxed) {
        batch.clear();
        return;
    }

    let url = format!("{}/api/telemetry/batch", API_HOST);
    let body = serde_json::json!({
        "client_id": client_uuid,
        "app_version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "events": batch,
    });

    let _ = client.post(&url).json(&body).send().await;
    batch.clear();
}
