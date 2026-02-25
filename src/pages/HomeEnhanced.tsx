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

  useEffect(() => {
    invoke<BreakRecord[]>("get_breaks_today").then(setBreaks);
    invoke<{ playing: boolean }>("get_audio_state").then((s) => setAudioPlaying(s.playing));
    const interval = setInterval(() => {
      invoke<BreakRecord[]>("get_breaks_today").then(setBreaks);
      invoke<{ playing: boolean }>("get_audio_state").then((s) => setAudioPlaying(s.playing));
    }, 30000);
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

  const toggleAudio = async () => {
    if (audioPlaying) {
      await invoke("stop_sound");
      await invoke("stop_youtube");
      setAudioPlaying(false);
    } else {
      const lastType = config?.audio_last_type;
      if (lastType) {
        await invoke("play_sound", { soundType: lastType, volume: config?.audio_last_volume ?? 10 });
        setAudioPlaying(true);
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
          <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">{methodLabel}</span>
        </div>
        <div className="text-3xl font-bold text-accent">{formatDuration(totalTimeToday)}</div>
        <div className="flex items-center gap-2 mt-2">
          <ProgressBar value={dayPct} max={100} color="#2ecc71" />
          <span className="text-xs text-text-muted whitespace-nowrap">{Math.round(dayPct)}% {t("home.day_progress")}</span>
        </div>
      </Card>

      {/* Break timers side by side */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <h3 className="text-text-muted text-xs mb-1">{t("home.small_break")}</h3>
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
          <h3 className="text-text-muted text-xs mb-1">{t("home.big_break")}</h3>
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

      {/* Water */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-text-muted text-xs">{t("home.water")}</h3>
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

        <Card>
          <h3 className="text-text-muted text-xs mb-2">{t("home.sound")}</h3>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${audioPlaying ? "text-accent" : "text-text-muted"}`}>
              {audioPlaying ? config?.audio_last_type ?? "♫" : t("home.sound_off")}
            </span>
          </div>
          <div className="flex gap-2 mt-2">
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
    </div>
  );
}
