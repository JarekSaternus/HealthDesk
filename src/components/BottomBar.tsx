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

export default function BottomBar() {
  const schedulerState = useAppStore((s) => s.schedulerState);
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
    <div className="h-10 bg-sidebar border-t border-card flex items-center justify-between px-4 text-xs text-text-muted">
      <span>
        {isPaused
          ? `⏸ ${t("status.pause")}`
          : outsideWorkHours
            ? `🌙 ${t("status.outside_work_hours")}`
            : `⏱ ${t("status.to_break", { time: formatTime(nextBreak) })}`}
      </span>
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
