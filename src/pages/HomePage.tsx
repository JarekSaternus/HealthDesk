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

export default function HomePage() {
  const config = useAppStore((s) => s.config);
  const schedulerState = useAppStore((s) => s.schedulerState);
  const waterToday = useAppStore((s) => s.waterToday);
  const totalTimeToday = useAppStore((s) => s.totalTimeToday);
  const [breaks, setBreaks] = useState<BreakRecord[]>([]);

  useEffect(() => {
    invoke<BreakRecord[]>("get_breaks_today").then(setBreaks);
    const interval = setInterval(() => {
      invoke<BreakRecord[]>("get_breaks_today").then(setBreaks);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const takenBreaks = breaks.filter((b) => !b.skipped).length;
  const skippedBreaks = breaks.filter((b) => b.skipped).length;
  const waterGoal = config?.water_daily_goal ?? 8;

  return (
    <div className="space-y-4">
      {/* Work time */}
      <Card>
        <h2 className="text-text-muted text-sm mb-1">{t("home.work_time_today")}</h2>
        <div className="text-3xl font-bold text-accent">{formatDuration(totalTimeToday)}</div>
      </Card>

      {/* Timers grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Next small break */}
        <Card>
          <h3 className="text-text-muted text-xs mb-1">{t("home.small_break")}</h3>
          <div className="text-xl font-mono text-text">
            {schedulerState ? formatCountdown(schedulerState.time_to_small_break) : "--:--"}
          </div>
        </Card>

        {/* Next big break */}
        <Card>
          <h3 className="text-text-muted text-xs mb-1">{t("home.big_break")}</h3>
          <div className="text-xl font-mono text-text">
            {schedulerState ? formatCountdown(schedulerState.time_to_big_break) : "--:--"}
          </div>
        </Card>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Breaks */}
        <Card>
          <h3 className="text-text-muted text-xs mb-2">{t("home.breaks")}</h3>
          <div className="flex gap-4">
            <div>
              <span className="text-2xl font-bold text-accent">{takenBreaks}</span>
              <span className="text-text-muted text-xs ml-1">taken</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-danger">{skippedBreaks}</span>
              <span className="text-text-muted text-xs ml-1">skipped</span>
            </div>
          </div>
        </Card>

        {/* Water */}
        <Card>
          <h3 className="text-text-muted text-xs mb-2">{t("home.water")}</h3>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-info">{waterToday}</span>
            <span className="text-text-muted text-sm">/ {waterGoal}</span>
            <span className="text-lg">💧</span>
          </div>
          {/* Water dots */}
          <div className="flex gap-1 mt-2">
            {Array.from({ length: waterGoal }, (_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full ${
                  i < waterToday ? "bg-info" : "bg-card-hover"
                }`}
              />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
