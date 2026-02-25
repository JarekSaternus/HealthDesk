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

  const nextBreak = schedulerState
    ? Math.min(
        schedulerState.time_to_small_break,
        schedulerState.time_to_big_break
      )
    : 0;

  const isPaused = schedulerState?.paused ?? false;

  return (
    <div className="h-10 bg-sidebar border-t border-card flex items-center px-4 text-xs text-text-muted gap-6">
      <span>
        {isPaused
          ? `⏸ ${t("status.pause")}`
          : `⏱ ${t("status.to_break", { time: formatTime(nextBreak) })}`}
      </span>
    </div>
  );
}
