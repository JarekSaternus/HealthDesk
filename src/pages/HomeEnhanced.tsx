import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { t } from "../i18n";
import DayTimeline from "../components/DayTimeline";
import type { BreakRecord, YTSearchResult, ActivitySummary } from "../types";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return t("home.now");
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getDayProgress(start: string, end: string): number {
  const now = new Date();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (endMin <= startMin) return 0;
  return Math.max(0, Math.min(100, ((nowMin - startMin) / (endMin - startMin)) * 100));
}

/* Circular progress ring */
function CircularProgress({
  value, max, size = 80, strokeWidth = 6, color, children,
}: {
  value: number; max: number; size?: number; strokeWidth?: number; color: string; children?: React.ReactNode;
}) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-card-hover" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return t("home.good_morning") || "Good morning";
  if (h < 18) return t("home.good_afternoon") || "Good afternoon";
  return t("home.good_evening") || "Good evening";
}

function getDateString(): string {
  const now = new Date();
  return now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export default function HomeEnhanced() {
  const config = useAppStore((s) => s.config);
  const schedulerState = useAppStore((s) => s.schedulerState);
  const waterToday = useAppStore((s) => s.waterToday);
  const totalTimeToday = useAppStore((s) => s.totalTimeToday);
  const setPage = useAppStore((s) => s.setPage);
  const [breaks, setBreaks] = useState<BreakRecord[]>([]);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YTSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showAllResults, setShowAllResults] = useState(false);
  const [topApps, setTopApps] = useState<ActivitySummary[]>([]);
  const methodRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<BreakRecord[]>("get_breaks_today").then(setBreaks);
    invoke<{ playing: boolean }>("get_audio_state").then((s) => setAudioPlaying(s.playing));
    invoke<ActivitySummary[]>("get_activity_today").then((apps) => setTopApps(apps.slice(0, 5)));
    const interval = setInterval(() => {
      invoke<BreakRecord[]>("get_breaks_today").then(setBreaks);
      invoke<{ playing: boolean }>("get_audio_state").then((s) => setAudioPlaying(s.playing));
      invoke<ActivitySummary[]>("get_activity_today").then((apps) => setTopApps(apps.slice(0, 5)));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const takenBreaks = breaks.filter((b) => !b.skipped).length;
  const skippedBreaks = breaks.filter((b) => b.skipped).length;
  const totalBreaks = takenBreaks + skippedBreaks;
  const smallTaken = breaks.filter((b) => b.type === "small" && !b.skipped).length;
  const smallSkipped = breaks.filter((b) => b.type === "small" && b.skipped).length;
  const bigTaken = breaks.filter((b) => b.type === "big" && !b.skipped).length;
  const bigSkipped = breaks.filter((b) => b.type === "big" && b.skipped).length;
  const waterGoal = config?.water_daily_goal ?? 8;
  const workStart = config?.work_hours_start ?? "08:00";
  const workEnd = config?.work_hours_end ?? "18:00";
  const dayPct = getDayProgress(workStart, workEnd);

  const smallBreakMax = (config?.small_break_interval_min ?? 25) * 60;
  const bigBreakMax = (config?.big_break_interval_min ?? 100) * 60;
  const nextBreakSeconds = schedulerState
    ? Math.min(schedulerState.time_to_small_break, schedulerState.time_to_big_break)
    : 0;
  const nextBreakMax = schedulerState
    ? (schedulerState.time_to_small_break <= schedulerState.time_to_big_break ? smallBreakMax : bigBreakMax)
    : 1;

  const METHODS = ["pomodoro", "20-20-20", "52-17", "90-min", "custom"];

  const changeMethod = async (method: string) => {
    if (!config) return;
    const newConfig = { ...config, work_method: method };
    await useAppStore.getState().saveConfig(newConfig);
    setShowMethodPicker(false);
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (methodRef.current && !methodRef.current.contains(e.target as Node)) {
        setShowMethodPicker(false);
      }
    };
    if (showMethodPicker) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMethodPicker]);

  // Close search on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    };
    if (showSearch) {
      document.addEventListener("mousedown", handler);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener("mousedown", handler);
  }, [showSearch]);

  const doSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const results = await invoke<YTSearchResult[]>("search_youtube_cmd", { query: searchQuery });
      setSearchResults(results);
      setShowAllResults(false);
    } catch {
      setSearchResults([]);
    }
    setSearchLoading(false);
  };

  const playSearchResult = async (r: YTSearchResult) => {
    await invoke("stop_sound");
    await invoke("stop_youtube");
    try {
      await invoke("play_youtube", { url: r.url, name: r.title, volume: config?.audio_last_volume ?? 10 });
      setAudioPlaying(true);
      if (config) {
        useAppStore.getState().saveConfig({ ...config, audio_last_type: r.url, audio_last_source: "youtube", audio_last_name: r.title, audio_last_volume: config.audio_last_volume });
      }
      setShowSearch(false);
    } catch { /* ignore */ }
  };

  const NATIVE_SOUNDS = ["brown_noise", "rain", "white_noise", "pink_noise", "drone", "forest"];

  const toggleAudio = async () => {
    if (audioPlaying) {
      await invoke("stop_sound");
      await invoke("stop_youtube");
      setAudioPlaying(false);
    } else {
      const lastType = config?.audio_last_type;
      const lastSource = config?.audio_last_source;
      const vol = config?.audio_last_volume ?? 10;
      if (lastType && NATIVE_SOUNDS.includes(lastType)) {
        await invoke("play_sound", { soundType: lastType, volume: vol });
        setAudioPlaying(true);
      } else if (lastSource === "radio" && lastType) {
        try {
          await invoke("play_radio", { url: lastType, name: config?.audio_last_name ?? "Radio", volume: vol });
          setAudioPlaying(true);
        } catch {
          setPage("music");
        }
      } else if (lastSource === "youtube" && lastType) {
        try {
          await invoke("play_youtube_search", { query: lastType, volume: vol });
          setAudioPlaying(true);
        } catch {
          setPage("music");
        }
      } else {
        setPage("music");
      }
    }
  };

  // Max activity time for bar width
  const maxActivitySec = topApps.length > 0 ? topApps[0].total_sec : 1;

  return (
    <div className="space-y-5">
      {/* Greeting bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">{getGreeting()}</h1>
          <p className="text-sm text-text-muted mt-0.5">{getDateString()}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status badges */}
          {schedulerState?.idle && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2.5 py-1 rounded-full">
              {t("home.idle")}
            </span>
          )}
          {schedulerState?.dnd && (
            <span className="text-xs bg-purple-500/20 text-purple-400 px-2.5 py-1 rounded-full">
              {t("home.dnd")}
            </span>
          )}
          {schedulerState?.in_meeting && (
            <span className="text-xs bg-red-500/20 text-red-400 px-2.5 py-1 rounded-full">
              {t("status_in_meeting")}
            </span>
          )}
          <div className="text-right">
            <div className="text-lg font-bold text-accent">{formatDuration(totalTimeToday)}</div>
            <div className="text-[10px] text-text-muted">{t("home.work_time_today")}</div>
          </div>
        </div>
      </div>

      {/* 3 stat cards */}
      {schedulerState?.outside_work_hours ? (
        <div className="bg-card rounded-xl p-6 text-center">
          <span className="text-text-muted text-sm">{t("home.outside_work_hours")}</span>
          <div className="text-xs text-text-muted mt-1">{workStart}–{workEnd}</div>
        </div>
      ) : schedulerState ? (
        <div className="grid grid-cols-3 gap-4">
          {/* Next break */}
          <div className="bg-card rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-text-muted font-medium">{t("home.next_break") || "Next break"}</h3>
              <span className="text-[10px] text-text-muted">
                {schedulerState.time_to_small_break <= schedulerState.time_to_big_break ? t("home.small_break") : t("home.big_break")}
              </span>
            </div>
            <div className="flex items-center justify-center">
              <CircularProgress value={nextBreakMax - nextBreakSeconds} max={nextBreakMax} size={90} strokeWidth={7} color="#2ecc71">
                <span className="text-xl font-mono font-bold text-text">{formatCountdown(nextBreakSeconds)}</span>
              </CircularProgress>
            </div>
            <div className="flex justify-between mt-3 text-[10px] text-text-muted">
              <span>{t("home.small_break")}: {formatCountdown(schedulerState.time_to_small_break)}</span>
              <span>{t("home.big_break")}: {formatCountdown(schedulerState.time_to_big_break)}</span>
            </div>
          </div>

          {/* Breaks taken */}
          <div className="bg-card rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-text-muted font-medium">{t("home.breaks")}</h3>
              <span className="text-[10px] text-text-muted">{t("home.daily_goal") || "Daily"}</span>
            </div>
            <div className="flex items-center justify-center">
              <CircularProgress value={takenBreaks} max={Math.max(takenBreaks + skippedBreaks, 8)} size={90} strokeWidth={7} color="#2ecc71">
                <div className="text-center">
                  <span className="text-2xl font-bold text-text">{takenBreaks}</span>
                  <span className="text-sm text-text-muted">/{takenBreaks + skippedBreaks || "0"}</span>
                </div>
              </CircularProgress>
            </div>
            <div className="flex justify-between mt-3 text-[10px] text-text-muted">
              <span className="text-accent">{smallTaken}+{bigTaken} {t("home.breaks_taken")}</span>
              {(smallSkipped + bigSkipped) > 0 && <span className="text-danger">{smallSkipped + bigSkipped} {t("home.breaks_skipped")}</span>}
            </div>
          </div>

          {/* Water intake */}
          <div className="bg-card rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-text-muted font-medium">{t("home.water")}</h3>
              <button
                onClick={() => useAppStore.getState().logWater()}
                className="text-[10px] bg-info/20 text-info px-2 py-0.5 rounded-full hover:bg-info/30 transition-colors"
              >
                +1
              </button>
            </div>
            <div className="flex items-center justify-center">
              <CircularProgress value={waterToday} max={waterGoal} size={90} strokeWidth={7} color="#3498db">
                <div className="text-center">
                  <span className="text-2xl font-bold text-text">{waterToday}</span>
                  <span className="text-sm text-text-muted">/{waterGoal}</span>
                </div>
              </CircularProgress>
            </div>
            <div className="text-center mt-3 text-[10px] text-text-muted">
              {schedulerState && schedulerState.time_to_water > 0 && (
                <span>{t("home.next_water")} {formatCountdown(schedulerState.time_to_water)}</span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Work method pills */}
      <div className="bg-card rounded-xl p-4" ref={methodRef}>
        <h3 className="text-xs text-text-muted font-medium mb-3">{t("home.work_method") || "Work Method"}</h3>
        <div className="flex gap-2 flex-wrap">
          {METHODS.map((m) => (
            <button
              key={m}
              onClick={() => changeMethod(m)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                config?.work_method === m
                  ? "bg-accent text-white"
                  : "bg-card-hover text-text-muted hover:text-text hover:bg-card-hover/80"
              }`}
            >
              {t(`settings.method_${m.replace(/-/g, "_")}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Day timeline */}
      {config?.work_hours_enabled && !schedulerState?.outside_work_hours && (
        <div className="bg-card rounded-xl p-4">
          <DayTimeline />
        </div>
      )}

      {/* Day progress bar */}
      {config?.work_hours_enabled && (
        <div className="bg-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted font-medium">{t("home.day_progress")}</span>
            <span className="text-xs text-text-muted">{workStart} — {workEnd}</span>
          </div>
          <div className="w-full h-2 bg-card-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
              style={{ width: `${dayPct}%` }}
            />
          </div>
          <div className="text-right mt-1">
            <span className="text-xs text-accent font-medium">{Math.round(dayPct)}%</span>
          </div>
        </div>
      )}

      {/* Top Activities */}
      {topApps.length > 0 && (
        <div className="bg-card rounded-xl p-4">
          <h3 className="text-xs text-text-muted font-medium mb-3">{t("stats.top_apps") || "Top Activities"}</h3>
          <div className="space-y-2.5">
            {topApps.map((app) => (
              <div key={app.process_name} className="flex items-center gap-3">
                <span className="text-sm w-6 text-center">
                  {app.category === "browser" ? "🌐" : app.category === "communication" ? "💬" : app.category === "development" ? "💻" : "📄"}
                </span>
                <span className="text-sm text-text truncate w-24">{app.process_name}</span>
                <div className="flex-1 h-2 bg-card-hover rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(app.total_sec / maxActivitySec) * 100}%`,
                      backgroundColor: app.category === "development" ? "#2ecc71" : app.category === "browser" ? "#f39c12" : app.category === "communication" ? "#9b59b6" : "#3498db",
                    }}
                  />
                </div>
                <span className="text-xs text-text-muted whitespace-nowrap">{formatDuration(app.total_sec)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sound mini-player */}
      <div className="bg-card rounded-xl p-4 relative">
        <div className="flex items-center gap-3">
          <h3 className="text-xs text-text-muted font-medium">{t("home.sound")}</h3>
          <span className={`text-xs truncate flex-1 ${audioPlaying ? "text-accent" : "text-text-muted"}`}>
            {audioPlaying ? config?.audio_last_name || config?.audio_last_type || "♫" : t("home.sound_off")}
          </span>
          <button
            onClick={toggleAudio}
            className="w-7 h-7 rounded-full bg-card-hover flex items-center justify-center hover:bg-accent/20 transition-colors text-sm"
          >
            {audioPlaying ? "⏹" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={config?.audio_last_volume ?? 10}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (config) {
                useAppStore.getState().saveConfig({ ...config, audio_last_volume: v });
              }
            }}
            onMouseUp={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              invoke("set_sound_volume", { volume: v });
            }}
            onTouchEnd={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              invoke("set_sound_volume", { volume: v });
            }}
            className="w-20 h-1"
          />
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="w-7 h-7 rounded-full bg-card-hover flex items-center justify-center hover:bg-accent/20 transition-colors text-xs"
            title={t("home.search_music")}
          >
            🔍
          </button>
          <button
            onClick={() => setPage("music")}
            className="w-7 h-7 rounded-full bg-card-hover flex items-center justify-center hover:bg-accent/20 transition-colors text-sm"
          >
            ♫
          </button>
        </div>

        {/* Search modal */}
        {showSearch && (
          <div
            ref={searchRef}
            className="absolute left-0 right-0 top-full mt-1 bg-card border border-card-hover rounded-xl shadow-lg z-20 p-3"
          >
            <div className="flex gap-2 mb-2">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()}
                placeholder={t("home.search_placeholder")}
                className="flex-1 bg-content border border-card-hover rounded-lg px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
              />
              <button
                onClick={doSearch}
                disabled={searchLoading}
                className="text-xs bg-accent/20 text-accent px-3 py-1.5 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50"
              >
                {searchLoading ? t("home.searching") : t("music.search")}
              </button>
            </div>
            {searchResults.length > 0 ? (
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {(showAllResults ? searchResults : searchResults.slice(0, 5)).map((r, i) => (
                  <button
                    key={i}
                    onClick={() => playSearchResult(r)}
                    className="w-full text-left p-2 rounded-lg hover:bg-card-hover text-xs flex justify-between gap-2"
                  >
                    <span className="truncate">{r.title}</span>
                    <span className="text-text-muted whitespace-nowrap">{r.duration}</span>
                  </button>
                ))}
                {searchResults.length > 5 && (
                  <button
                    onClick={() => setShowAllResults(!showAllResults)}
                    className="w-full text-center text-xs text-accent py-1 hover:bg-accent/10 rounded-lg transition-colors"
                  >
                    {showAllResults ? t("home.show_less") : `${t("home.show_more")} (${searchResults.length - 5})`}
                  </button>
                )}
              </div>
            ) : searchLoading ? null : searchQuery && searchResults.length === 0 ? (
              <div className="text-xs text-text-muted text-center py-2">{t("home.no_results")}</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
