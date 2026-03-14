import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { t } from "../i18n";

function formatTime(seconds: number): string {
  if (seconds <= 0) return t("home.now");
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function BottomBar() {
  const schedulerState = useAppStore((s) => s.schedulerState);
  const totalTimeToday = useAppStore((s) => s.totalTimeToday);
  const [confirmReset, setConfirmReset] = useState(false);

  const nextBreak = schedulerState
    ? Math.min(
        schedulerState.time_to_small_break,
        schedulerState.time_to_big_break
      )
    : 0;

  const isPaused = schedulerState?.paused ?? false;
  const outsideWorkHours = schedulerState?.outside_work_hours ?? false;

  const handleReset = async () => {
    await invoke("reset_timers");
    setConfirmReset(false);
  };

  return (
    <div className="h-9 bg-sidebar/80 border-t border-card/30 flex items-center justify-between px-4 text-[11px] text-text-muted">
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1 ${isPaused ? "text-warning" : outsideWorkHours ? "text-text-muted" : "text-accent"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isPaused ? "bg-warning" : outsideWorkHours ? "bg-text-muted" : "bg-accent"}`} />
          {isPaused
            ? t("status.pause")
            : outsideWorkHours
              ? t("status.outside_work_hours")
              : t("status.active") || "Session active"}
        </span>
        <span>·</span>
        <span>{formatDuration(totalTimeToday)} {t("status.elapsed") || "elapsed"}</span>
        {!isPaused && !outsideWorkHours && (
          <>
            <span>·</span>
            <span>{t("status.to_break", { time: formatTime(nextBreak) })}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {confirmReset ? (
          <>
            <span className="text-text-muted">{t("status.reset_confirm")}</span>
            <button
              onClick={handleReset}
              className="px-2 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
            >
              {t("status.reset_yes")}
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              className="px-2 py-0.5 rounded bg-card-hover text-text-muted hover:bg-card transition-colors"
            >
              {t("status.reset_no")}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmReset(true)}
            className="text-text-muted hover:text-accent transition-colors"
            title={t("status.reset_timers")}
          >
            ↻
          </button>
        )}
      </div>
    </div>
  );
}
