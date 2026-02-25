pub mod generators;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use rodio::{OutputStream, Sink, Source};

pub struct AudioEngine {
    playing: Arc<AtomicBool>,
    volume: Arc<AtomicU32>,
    current_type: std::sync::Mutex<Option<String>>,
    stop_signal: Arc<AtomicBool>,
}

impl AudioEngine {
    pub fn new() -> Self {
        Self {
            playing: Arc::new(AtomicBool::new(false)),
            volume: Arc::new(AtomicU32::new(10)),
            current_type: std::sync::Mutex::new(None),
            stop_signal: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn play(&self, sound_type: &str, volume: u32) {
        self.stop();
        self.volume.store(volume, Ordering::Relaxed);
        self.playing.store(true, Ordering::Relaxed);
        self.stop_signal.store(false, Ordering::Relaxed);
        *self.current_type.lock().unwrap() = Some(sound_type.to_string());

        let playing = self.playing.clone();
        let vol = self.volume.clone();
        let stop = self.stop_signal.clone();
        let stype = sound_type.to_string();

        thread::spawn(move || {
            let Ok((_stream, stream_handle)) = OutputStream::try_default() else {
                playing.store(false, Ordering::Relaxed);
                return;
            };
            let Ok(sink) = Sink::try_new(&stream_handle) else {
                playing.store(false, Ordering::Relaxed);
                return;
            };

            let source: Box<dyn Source<Item = f32> + Send + Sync> = match stype.as_str() {
                "brown_noise" => Box::new(generators::BrownNoise::new()),
                "rain" => Box::new(generators::Rain::new()),
                "white_noise" => Box::new(generators::WhiteNoise::new()),
                "pink_noise" => Box::new(generators::PinkNoise::new()),
                "drone" => Box::new(generators::AmbientDrone::new()),
                "forest" => Box::new(generators::Forest::new()),
                _ => {
                    playing.store(false, Ordering::Relaxed);
                    return;
                }
            };

            sink.append(source);

            loop {
                if stop.load(Ordering::Relaxed) {
                    sink.stop();
                    break;
                }
                let v = vol.load(Ordering::Relaxed) as f32 / 100.0;
                sink.set_volume(v);
                thread::sleep(std::time::Duration::from_millis(100));
            }
            playing.store(false, Ordering::Relaxed);
        });
    }

    pub fn stop(&self) {
        self.stop_signal.store(true, Ordering::Relaxed);
        self.playing.store(false, Ordering::Relaxed);
        *self.current_type.lock().unwrap() = None;
    }

    pub fn set_volume(&self, volume: u32) {
        self.volume.store(volume.min(100), Ordering::Relaxed);
    }

    pub fn is_playing(&self) -> bool {
        self.playing.load(Ordering::Relaxed)
    }

    pub fn current_type(&self) -> Option<String> {
        self.current_type.lock().unwrap().clone()
    }

    pub fn play_chime(&self) {
        thread::spawn(move || {
            let Ok((_stream, stream_handle)) = OutputStream::try_default() else { return };
            let Ok(sink) = Sink::try_new(&stream_handle) else { return };
            let chime = generators::generate_chime();
            sink.append(chime);
            sink.sleep_until_end();
        });
    }
}

unsafe impl Send for AudioEngine {}
unsafe impl Sync for AudioEngine {}
