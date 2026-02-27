import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { t } from "../i18n";
import Card from "../components/Card";
import type { BreakRecord, YTSearchResult } from "../types";

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

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-2 bg-card-hover rounded-full overflow-hidden mt-1">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
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
  const methodRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<BreakRecord[]>("get_breaks_today").then(setBreaks);
    invoke<{ playing: boolean }>("get_audio_state").then((s) => setAudioPlaying(s.playing));
    const interval = setInterval(() => {
      invoke<BreakRecord[]>("get_breaks_today").then(setBreaks);
      invoke<{ playing: boolean }>("get_audio_state").then((s) => setAudioPlaying(s.playing));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const takenBreaks = breaks.filter((b) => !b.skipped).length;
  const skippedBreaks = breaks.filter((b) => b.skipped).length;
  const waterGoal = config?.water_daily_goal ?? 8;
  const workStart = config?.work_hours_start ?? "08:00";
  const workEnd = config?.work_hours_end ?? "18:00";
  const dayPct = getDayProgress(workStart, workEnd);

  const methodLabel = config?.work_method === "custom"
    ? t("settings.method_custom")
    : config?.work_method ?? "pomodoro";

  const smallBreakMax = (config?.small_break_interval_min ?? 25) * 60;
  const bigBreakMax = (config?.big_break_interval_min ?? 100) * 60;

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
        useAppStore.getState().saveConfig({ ...config, audio_last_type: r.url, audio_last_source: "youtube", audio_last_volume: config.audio_last_volume });
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

  return (
    <div className="space-y-4">
      {/* Work time + method badge + day progress */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-text-muted text-sm">{t("home.work_time_today")}</h2>
          <div className="relative" ref={methodRef}>
            <button
              onClick={() => setShowMethodPicker(!showMethodPicker)}
              className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full hover:bg-accent/30 transition-colors cursor-pointer"
              title={t(`settings.method_${(config?.work_method ?? "pomodoro").replace(/-/g, "_")}_desc`)}
            >
              {methodLabel} ▾
            </button>
            {showMethodPicker && (
              <div className="absolute right-0 top-7 bg-card border border-card-hover rounded-lg shadow-lg z-10 py-1 min-w-[140px]">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => changeMethod(m)}
                    className={`block w-full text-left text-xs px-3 py-1.5 hover:bg-card-hover transition-colors ${
                      config?.work_method === m ? "text-accent" : "text-text"
                    }`}
                  >
                    {t(`settings.method_${m.replace(/-/g, "_")}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="text-3xl font-bold text-accent">{formatDuration(totalTimeToday)}</div>
        {config?.work_hours_enabled && (
          <div className="flex items-center gap-2 mt-2">
            <ProgressBar value={dayPct} max={100} color="#2ecc71" />
            <span className="text-xs text-text-muted whitespace-nowrap">{Math.round(dayPct)}% {t("home.day_progress")} ({workStart}–{workEnd})</span>
          </div>
        )}
      </Card>

      {/* Idle / DND status badge */}
      {(schedulerState?.idle || schedulerState?.dnd) && (
        <Card>
          <div className="flex items-center gap-2 py-1">
            {schedulerState.idle && (
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                {t("home.idle")}
              </span>
            )}
            {schedulerState.dnd && (
              <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                {t("home.dnd")}
              </span>
            )}
            <span className="text-xs text-text-muted">
              {schedulerState.idle ? t("settings.idle_enabled_desc") : ""}
            </span>
          </div>
        </Card>
      )}

      {/* Break timers side by side */}
      {schedulerState?.outside_work_hours ? (
        <Card>
          <div className="text-center py-2">
            <span className="text-text-muted text-sm">{t("home.outside_work_hours")}</span>
            <div className="text-xs text-text-muted mt-1">{workStart}–{workEnd}</div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-text-muted text-xs">{t("home.small_break")}</h3>
              <span className="text-xs text-text-muted">{config?.small_break_interval_min ?? 25} min</span>
            </div>
            <div className="text-xl font-mono" style={{ color: "#3498db" }}>
              {schedulerState ? formatCountdown(schedulerState.time_to_small_break) : "--:--"}
            </div>
            {schedulerState && (
              <ProgressBar
                value={smallBreakMax - schedulerState.time_to_small_break}
                max={smallBreakMax}
                color="#3498db"
              />
            )}
          </Card>
          <Card>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-text-muted text-xs">{t("home.big_break")}</h3>
              <span className="text-xs text-text-muted">{config?.big_break_interval_min ?? 100} min</span>
            </div>
            <div className="text-xl font-mono" style={{ color: "#e67e22" }}>
              {schedulerState ? formatCountdown(schedulerState.time_to_big_break) : "--:--"}
            </div>
            {schedulerState && (
              <ProgressBar
                value={bigBreakMax - schedulerState.time_to_big_break}
                max={bigBreakMax}
                color="#e67e22"
              />
            )}
          </Card>
        </div>
      )}

      {/* Water */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-text-muted text-xs">{t("home.water")}</h3>
            <span className="text-sm font-bold text-info">{waterToday}</span>
            <span className="text-xs text-text-muted">/ {waterGoal}</span>
          </div>
          <button
            onClick={() => useAppStore.getState().logWater()}
            className="text-xs bg-info/20 text-info px-2 py-0.5 rounded hover:bg-info/30 transition-colors"
          >
            +1
          </button>
        </div>
        <div className="flex gap-1.5 mb-1">
          {Array.from({ length: waterGoal }, (_, i) => (
            <span key={i} className={`text-sm ${i < waterToday ? "text-info" : "text-card-hover"}`}>
              {i < waterToday ? "●" : "○"}
            </span>
          ))}
        </div>
        <ProgressBar value={waterToday} max={waterGoal} color="#3498db" />
        {schedulerState && schedulerState.time_to_water > 0 && (
          <div className="text-xs text-text-muted mt-1">
            {t("home.next_water")} {formatCountdown(schedulerState.time_to_water)}
          </div>
        )}
      </Card>

      {/* Breaks taken/skipped + Sound */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <h3 className="text-text-muted text-xs mb-2">{t("home.breaks")}</h3>
          <div className="flex gap-4">
            <div>
              <span className="text-2xl font-bold text-accent">{takenBreaks}</span>
              <span className="text-text-muted text-xs ml-1">{t("home.breaks_taken")}</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-danger">{skippedBreaks}</span>
              <span className="text-text-muted text-xs ml-1">{t("home.breaks_skipped")}</span>
            </div>
          </div>
        </Card>

        <Card className="relative">
          <h3 className="text-text-muted text-xs mb-2">{t("home.sound")}</h3>
          <div className="flex items-center gap-2">
            <span className={`text-sm truncate ${audioPlaying ? "text-accent" : "text-text-muted"}`}>
              {audioPlaying ? config?.audio_last_type ?? "♫" : t("home.sound_off")}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={toggleAudio}
              className="text-xs bg-card-hover px-2 py-1 rounded hover:bg-accent/20 transition-colors"
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
              className="flex-1 h-1"
            />
            <button
              onClick={() => setShowSearch(!showSearch)}
              className="text-xs bg-card-hover px-2 py-1 rounded hover:bg-accent/20 transition-colors"
              title={t("home.search_music")}
            >
              🔍
            </button>
            <button
              onClick={() => setPage("music")}
              className="text-xs bg-card-hover px-2 py-1 rounded hover:bg-accent/20 transition-colors"
            >
              ♫
            </button>
          </div>

          {/* Search modal */}
          {showSearch && (
            <div
              ref={searchRef}
              className="absolute left-0 right-0 top-full mt-1 bg-card border border-card-hover rounded-lg shadow-lg z-20 p-3"
            >
              <div className="flex gap-2 mb-2">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  placeholder={t("home.search_placeholder")}
                  className="flex-1 bg-content border border-card-hover rounded px-2 py-1 text-xs text-text outline-none focus:border-accent"
                />
                <button
                  onClick={doSearch}
                  disabled={searchLoading}
                  className="text-xs bg-accent/20 text-accent px-3 py-1 rounded hover:bg-accent/30 transition-colors disabled:opacity-50"
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
                      className="w-full text-left p-1.5 rounded hover:bg-card-hover text-xs flex justify-between gap-2"
                    >
                      <span className="truncate">{r.title}</span>
                      <span className="text-text-muted whitespace-nowrap">{r.duration}</span>
                    </button>
                  ))}
                  {searchResults.length > 5 && (
                    <button
                      onClick={() => setShowAllResults(!showAllResults)}
                      className="w-full text-center text-xs text-accent py-1 hover:bg-accent/10 rounded transition-colors"
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
        </Card>
      </div>
    </div>
  );
}
