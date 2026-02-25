export interface AppConfig {
  work_method: string;
  small_break_interval_min: number;
  small_break_duration_sec: number;
  big_break_interval_min: number;
  big_break_duration_min: number;
  break_mode: "moderate" | "aggressive";
  water_interval_min: number;
  water_daily_goal: number;
  eye_exercise_interval_min: number;
  work_hours_start: string;
  work_hours_end: string;
  work_hours_enabled: boolean;
  autostart: boolean;
  sound_notifications: boolean;
  show_ads: boolean;
  telemetry_enabled: boolean;
  track_window_titles: boolean;
  audio_autoplay: boolean;
  audio_last_source: string | null;
  audio_last_type: string | null;
  audio_last_volume: number;
  language: string;
  auto_update: boolean;
  dashboard_layout: string;
}

export interface SchedulerState {
  paused: boolean;
  popup_paused: boolean;
  outside_work_hours: boolean;
  time_to_small_break: number;
  time_to_big_break: number;
  time_to_water: number;
  time_to_eye: number;
  include_eyes_in_big_break: boolean;
}

export interface BreakRecord {
  id: number;
  timestamp: string;
  type: string;
  duration_sec: number;
  skipped: boolean;
}

export interface ActivitySummary {
  process_name: string;
  category: string;
  total_sec: number;
}

export interface CategorySummary {
  category: string;
  total_sec: number;
}

export interface DailyTotal {
  day: string;
  total_sec: number;
}

export interface DailyBreaks {
  day: string;
  count: number;
  skipped_count: number;
}

export interface WorkMethodPreset {
  small_break_interval_min: number;
  small_break_duration_sec: number;
  big_break_interval_min: number;
  big_break_duration_min: number;
  eye_exercise_interval_min: number;
}

export interface Ad {
  title: string;
  description: string;
  image_url: string;
  click_url: string;
  bg_color: string;
  text_color: string;
  ad_id: string;
}

export interface YTStation {
  key: string;
  name: string;
  query: string;
}

export interface YTSearchResult {
  title: string;
  url: string;
  duration: string;
  channel: string;
}

export type Page = "home" | "stats" | "music" | "settings" | "help";
