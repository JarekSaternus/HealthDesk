import { useAppStore } from "../stores/appStore";
import { t } from "../i18n";
import type { Page } from "../types";

const navItems: { key: Page; icon: string; }[] = [
  { key: "home", icon: "🏠" },
  { key: "stats", icon: "📊" },
  { key: "music", icon: "🎵" },
  { key: "settings", icon: "⚙️" },
  { key: "help", icon: "❓" },
];

export default function Sidebar() {
  const currentPage = useAppStore((s) => s.currentPage);
  const setPage = useAppStore((s) => s.setPage);
  const schedulerState = useAppStore((s) => s.schedulerState);
  const logWater = useAppStore((s) => s.logWater);
  const togglePause = useAppStore((s) => s.togglePause);
  const waterToday = useAppStore((s) => s.waterToday);
  const config = useAppStore((s) => s.config);

  const isPaused = schedulerState?.paused ?? false;

  return (
    <div className="w-48 bg-sidebar flex flex-col h-full border-r border-card/50">
      {/* Logo */}
      <div className="px-4 py-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
            <span className="text-accent font-bold text-sm">HD</span>
          </div>
          <span className="text-accent font-semibold text-sm">HealthDesk</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setPage(item.key)}
            className={`w-full text-left px-3 py-2.5 flex items-center gap-3 rounded-lg transition-all
              ${currentPage === item.key
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:bg-card/50 hover:text-text"
              }`}
          >
            <span className="text-base">{item.icon}</span>
            <span className="text-sm">{t(`nav.${item.key}`)}</span>
          </button>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="p-3 space-y-2">
        <button
          onClick={logWater}
          className="w-full bg-info/10 text-info hover:bg-info/20 rounded-lg px-3 py-2 text-xs transition-colors flex items-center justify-center gap-1.5"
        >
          💧 +1 ({waterToday}/{config?.water_daily_goal ?? 8})
        </button>
        <button
          onClick={togglePause}
          className={`w-full rounded-lg px-3 py-2.5 text-xs transition-colors flex items-center justify-center gap-1.5 ${
            isPaused
              ? "bg-accent/15 text-accent hover:bg-accent/25"
              : "bg-card/50 text-text-muted hover:bg-card"
          }`}
        >
          {isPaused ? `▶ ${t("nav.resume")}` : `⏸ ${t("nav.pause")}`}
        </button>
      </div>
    </div>
  );
}
