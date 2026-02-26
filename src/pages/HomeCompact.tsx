import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { t } from "../i18n";
import Card from "../components/Card";
import type { BreakRecord } from "../types";

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

export default function HomeCompact() {
  const config = useAppStore((s) => s.config);
  const schedulerState = useAppStore((s) => s.schedulerState);
  const waterToday = useAppStore((s) => s.waterToday);
  const totalTimeToday = useAppStore((s) => s.totalTimeToday);
  const setPage = useAppStore((s) => s.setPage);
  const [breaks, setBreaks] = useState<BreakRecord[]>([]);
  const [audioPlaying, setAudioPlaying] = useState(false);

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

  const methodLabel = config?.work_method === "custom"
    ? t("settings.method_custom")
    : config?.work_method ?? "pomodoro";

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
    <div className="grid grid-cols-2 gap-4">
      {/* Work time */}
      <Card>
        <h3 className="text-text-muted text-xs mb-1">{t("home.work_time_today")}</h3>
        <div className="text-3xl font-bold text-accent">{formatDuration(totalTimeToday)}</div>
      </Card>

      {/* Breaks */}
      <Card>
        <h3 className="text-text-muted text-xs mb-1">{t("home.breaks")}</h3>
        <div className="flex gap-3 mb-2">
          <div>
            <span className="text-xl font-bold text-accent">{takenBreaks}</span>
            <span className="text-text-muted text-xs ml-1">{t("home.breaks_taken")}</span>
          </div>
          <div>
            <span className="text-xl font-bold text-danger">{skippedBreaks}</span>
            <span className="text-text-muted text-xs ml-1">{t("home.breaks_skipped")}</span>
          </div>
        </div>
        <div className="text-xs text-text-muted">
          {schedulerState?.outside_work_hours ? (
            t("home.outside_work_hours")
          ) : (
            <>
              {t("home.small_break")}: {schedulerState ? formatCountdown(schedulerState.time_to_small_break) : "--:--"}
              {" | "}
              {t("home.big_break")}: {schedulerState ? formatCountdown(schedulerState.time_to_big_break) : "--:--"}
            </>
          )}
        </div>
        <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full mt-2 inline-block">{methodLabel}</span>
      </Card>

      {/* Water */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-text-muted text-xs">{t("home.water")}</h3>
          <button
            onClick={() => useAppStore.getState().logWater()}
            className="text-xs bg-info/20 text-info px-2 py-0.5 rounded hover:bg-info/30 transition-colors"
          >
            +1
          </button>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl font-bold text-info">{waterToday}</span>
          <span className="text-text-muted text-sm">/ {waterGoal}</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: waterGoal }, (_, i) => (
            <span key={i} className={`text-sm ${i < waterToday ? "text-info" : "text-card-hover"}`}>
              {i < waterToday ? "●" : "○"}
            </span>
          ))}
        </div>
      </Card>

      {/* Sound */}
      <Card>
        <h3 className="text-text-muted text-xs mb-1">{t("home.sound")}</h3>
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-sm ${audioPlaying ? "text-accent" : "text-text-muted"}`}>
            {audioPlaying ? config?.audio_last_type ?? "♫" : t("home.sound_off")}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={toggleAudio}
            className="text-xs bg-card-hover px-2 py-1 rounded hover:bg-accent/20 transition-colors"
          >
            {audioPlaying ? "⏹" : "▶"}
          </button>
          <button
            onClick={() => setPage("music")}
            className="text-xs bg-card-hover px-2 py-1 rounded hover:bg-accent/20 transition-colors"
          >
            ♫
          </button>
        </div>
      </Card>
    </div>
  );
}
