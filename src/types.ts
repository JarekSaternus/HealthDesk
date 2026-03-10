export interface AppConfig {
  work_method: string;
  small_break_interval_min: number;
  small_break_duration_sec: number;
  big_break_interval_min: number;
  big_break_duration_min: number;
  break_mode: "gentle" | "moderate" | "aggressive";
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
  audio_last_name: string | null;
  audio_last_volume: number;
  language: string;
  auto_update: boolean;
  dashboard_layout: string;
  breathing_exercise_interval_min: number;
  breathing_exercise_enabled: boolean;
  idle_detection_enabled: boolean;
  idle_threshold_min: number;
  onboarding_completed: boolean;
  weekly_schedule: WeeklySchedule | null;
  google_calendar_enabled: boolean;
  google_calendar_block_breaks: boolean;
  google_calendar_pre_meeting: boolean;
}

export interface DaySchedule {
  small_break_interval_min: number;
  small_break_duration_sec: number;
  big_break_interval_min: number;
  big_break_duration_min: number;
  eye_exercise_interval_min: number;
  water_interval_min: number;
  breathing_exercise_interval_min: number;
  breathing_exercise_enabled: boolean;
  enabled: boolean;
}

export interface WeeklySchedule {
  enabled: boolean;
  days: Record<string, DaySchedule>;
}

export interface EffectiveIntervals {
  small_break_interval_min: number;
  small_break_duration_sec: number;
  big_break_interval_min: number;
  big_break_duration_min: number;
  eye_exercise_interval_min: number;
  water_interval_min: number;
  breathing_exercise_interval_min: number;
  breathing_exercise_enabled: boolean;
  day_enabled: boolean;
}

export interface SchedulerState {
  paused: boolean;
  popup_paused: boolean;
  outside_work_hours: boolean;
  idle: boolean;
  dnd: boolean;
  time_to_small_break: number;
  time_to_big_break: number;
  time_to_water: number;
  time_to_eye: number;
  time_to_breathing: number;
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

export interface PeriodBreakStats {
  total: number;
  taken: number;
  skipped: number;
  by_type: { break_type: string; count: number }[];
}

export interface DailyWater {
  day: string;
  glasses: number;
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

export interface RadioStation {
  key: string;
  name: string;
  url: string;
}

export interface YTSearchResult {
  title: string;
  url: string;
  duration: string;
  channel: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  is_all_day: boolean;
}

export interface CalendarStateResponse {
  connected: boolean;
  events: CalendarEvent[];
}

export type Page = "home" | "stats" | "music" | "settings" | "help";
