import { useAppStore } from "../stores/appStore";
import { t } from "../i18n";
import type { Page } from "../types";

const navItems: { key: Page; icon: string }[] = [
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
    <div className="w-52 bg-sidebar flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 text-center border-b border-card">
        <h1 className="text-accent text-lg font-bold">HealthDesk</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2">
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setPage(item.key)}
            className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors
              ${currentPage === item.key
                ? "bg-card text-accent border-r-2 border-accent"
                : "text-text-muted hover:bg-card hover:text-text"
              }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-sm">{t(`nav.${item.key}`)}</span>
          </button>
        ))}
      </nav>

      {/* Quick actions */}
      <div className="p-3 border-t border-card space-y-2">
        <button
          onClick={logWater}
          className="w-full bg-info/20 text-info hover:bg-info/30 rounded px-3 py-2 text-sm transition-colors"
        >
          💧 {t("nav.water_plus")} ({waterToday}/{config?.water_daily_goal ?? 8})
        </button>
        <button
          onClick={togglePause}
          className={`w-full rounded px-3 py-2 text-sm transition-colors ${
            isPaused
              ? "bg-accent/20 text-accent hover:bg-accent/30"
              : "bg-warning/20 text-warning hover:bg-warning/30"
          }`}
        >
          {isPaused ? `▶ ${t("nav.resume")}` : `⏸ ${t("nav.pause")}`}
        </button>
      </div>
    </div>
  );
}
