use rand::Rng;
use rand::rngs::SmallRng;
use rand::SeedableRng;
use rodio::buffer::SamplesBuffer;
use rodio::Source;
use std::time::Duration;

const SAMPLE_RATE: u32 = 44100;

// ---- Brown Noise ----

pub struct BrownNoise {
    last: f32,
    rng: SmallRng,
}

impl BrownNoise {
    pub fn new() -> Self {
        Self {
            last: 0.0,
            rng: SmallRng::from_os_rng(),
        }
    }
}

impl Iterator for BrownNoise {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        self.last += self.rng.random_range(-0.02..0.02);
        self.last = self.last.clamp(-1.0, 1.0);
        Some(self.last * 0.5)
    }
}

impl Source for BrownNoise {
    fn current_frame_len(&self) -> Option<usize> { None }
    fn channels(&self) -> u16 { 1 }
    fn sample_rate(&self) -> u32 { SAMPLE_RATE }
    fn total_duration(&self) -> Option<Duration> { None }
}

// ---- White Noise ----

pub struct WhiteNoise {
    rng: SmallRng,
}

impl WhiteNoise {
    pub fn new() -> Self {
        Self { rng: SmallRng::from_os_rng() }
    }
}

impl Iterator for WhiteNoise {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        Some(self.rng.random_range(-1.0..1.0) * 0.3)
    }
}

impl Source for WhiteNoise {
    fn current_frame_len(&self) -> Option<usize> { None }
    fn channels(&self) -> u16 { 1 }
    fn sample_rate(&self) -> u32 { SAMPLE_RATE }
    fn total_duration(&self) -> Option<Duration> { None }
}

// ---- Pink Noise (7-octave averaging) ----

pub struct PinkNoise {
    octaves: [f32; 7],
    rng: SmallRng,
    counter: u32,
}

impl PinkNoise {
    pub fn new() -> Self {
        Self {
            octaves: [0.0; 7],
            rng: SmallRng::from_os_rng(),
            counter: 0,
        }
    }
}

impl Iterator for PinkNoise {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        self.counter = self.counter.wrapping_add(1);
        for i in 0..7 {
            if self.counter % (1 << i) == 0 {
                self.octaves[i] = self.rng.random_range(-1.0..1.0);
            }
        }
        let sum: f32 = self.octaves.iter().sum();
        Some(sum / 7.0 * 0.3)
    }
}

impl Source for PinkNoise {
    fn current_frame_len(&self) -> Option<usize> { None }
    fn channels(&self) -> u16 { 1 }
    fn sample_rate(&self) -> u32 { SAMPLE_RATE }
    fn total_duration(&self) -> Option<Duration> { None }
}

// ---- Rain (pink noise + random sine burst droplets) ----

pub struct Rain {
    pink: PinkNoise,
    rng: SmallRng,
    drop_phase: f32,
    drop_freq: f32,
    drop_remaining: u32,
    sample_idx: u64,
}

impl Rain {
    pub fn new() -> Self {
        Self {
            pink: PinkNoise::new(),
            rng: SmallRng::from_os_rng(),
            drop_phase: 0.0,
            drop_freq: 2000.0,
            drop_remaining: 0,
            sample_idx: 0,
        }
    }
}

impl Iterator for Rain {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let base = self.pink.next().unwrap_or(0.0) * 0.7;
        self.sample_idx += 1;

        // Random droplet trigger
        if self.drop_remaining == 0 && self.rng.random_ratio(1, 4000) {
            self.drop_freq = self.rng.random_range(1500.0..4000.0);
            self.drop_remaining = self.rng.random_range(200..800);
            self.drop_phase = 0.0;
        }

        let drop_val = if self.drop_remaining > 0 {
            self.drop_remaining -= 1;
            let amplitude = (self.drop_remaining as f32 / 800.0).min(1.0) * 0.15;
            self.drop_phase += self.drop_freq / SAMPLE_RATE as f32;
            (self.drop_phase * std::f32::consts::TAU).sin() * amplitude
        } else {
            0.0
        };

        Some(base + drop_val)
    }
}

impl Source for Rain {
    fn current_frame_len(&self) -> Option<usize> { None }
    fn channels(&self) -> u16 { 1 }
    fn sample_rate(&self) -> u32 { SAMPLE_RATE }
    fn total_duration(&self) -> Option<Duration> { None }
}

// ---- Ambient Drone (layered sines with modulation) ----

pub struct AmbientDrone {
    phase: [f32; 4],
    freqs: [f32; 4],
    mod_phase: f32,
}

impl AmbientDrone {
    pub fn new() -> Self {
        Self {
            phase: [0.0; 4],
            // C2, G2, C3, G3
            freqs: [65.41, 98.0, 130.81, 196.0],
            mod_phase: 0.0,
        }
    }
}

impl Iterator for AmbientDrone {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let sr = SAMPLE_RATE as f32;
        self.mod_phase += 0.3 / sr;
        let modulation = 1.0 + 0.3 * (self.mod_phase * std::f32::consts::TAU).sin();

        let mut out = 0.0f32;
        let amps = [0.3, 0.2, 0.15, 0.1];
        for i in 0..4 {
            self.phase[i] += self.freqs[i] * modulation / sr;
            out += (self.phase[i] * std::f32::consts::TAU).sin() * amps[i];
        }
        Some(out * 0.4)
    }
}

impl Source for AmbientDrone {
    fn current_frame_len(&self) -> Option<usize> { None }
    fn channels(&self) -> u16 { 1 }
    fn sample_rate(&self) -> u32 { SAMPLE_RATE }
    fn total_duration(&self) -> Option<Duration> { None }
}

// ---- Forest (wind + bird chirps) ----

pub struct Forest {
    wind: BrownNoise,
    rng: SmallRng,
    chirp_phase: f32,
    chirp_freq: f32,
    chirp_remaining: u32,
    sample_idx: u64,
}

impl Forest {
    pub fn new() -> Self {
        Self {
            wind: BrownNoise::new(),
            rng: SmallRng::from_os_rng(),
            chirp_phase: 0.0,
            chirp_freq: 3000.0,
            chirp_remaining: 0,
            sample_idx: 0,
        }
    }
}

impl Iterator for Forest {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let base = self.wind.next().unwrap_or(0.0) * 0.4;
        self.sample_idx += 1;

        // Random bird chirp
        if self.chirp_remaining == 0 && self.rng.random_ratio(1, 8000) {
            self.chirp_freq = self.rng.random_range(2000.0..5000.0);
            self.chirp_remaining = self.rng.random_range(500..2000);
            self.chirp_phase = 0.0;
        }

        let chirp_val = if self.chirp_remaining > 0 {
            self.chirp_remaining -= 1;
            let amplitude = (self.chirp_remaining as f32 / 2000.0).min(1.0) * 0.08;
            // Frequency sweep for bird-like sound
            let freq = self.chirp_freq + (self.chirp_remaining as f32 * 2.0);
            self.chirp_phase += freq / SAMPLE_RATE as f32;
            (self.chirp_phase * std::f32::consts::TAU).sin() * amplitude
        } else {
            0.0
        };

        Some(base + chirp_val)
    }
}

impl Source for Forest {
    fn current_frame_len(&self) -> Option<usize> { None }
    fn channels(&self) -> u16 { 1 }
    fn sample_rate(&self) -> u32 { SAMPLE_RATE }
    fn total_duration(&self) -> Option<Duration> { None }
}

// ---- Chime (short notification sound) ----

pub fn generate_chime() -> SamplesBuffer<f32> {
    let duration_sec = 0.5;
    let num_samples = (SAMPLE_RATE as f32 * duration_sec) as usize;
    let mut samples = Vec::with_capacity(num_samples);

    let freq = 880.0; // A5
    for i in 0..num_samples {
        let t = i as f32 / SAMPLE_RATE as f32;
        let envelope = (1.0 - t / duration_sec).max(0.0);
        let val = (t * freq * std::f32::consts::TAU).sin() * envelope * 0.3;
        // Add a harmonic
        let val2 = (t * freq * 2.0 * std::f32::consts::TAU).sin() * envelope * 0.1;
        samples.push(val + val2);
    }

    SamplesBuffer::new(1, SAMPLE_RATE, samples)
}
