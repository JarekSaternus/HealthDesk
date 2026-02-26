import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { t } from "../i18n";
import Card from "../components/Card";
import type { CategorySummary, ActivitySummary, DailyTotal, DailyBreaks, PeriodBreakStats, DailyWater } from "../types";

const CATEGORY_COLORS: Record<string, string> = {
  Work: "#2ecc71",
  Browser: "#3498db",
  Communication: "#9b59b6",
  Entertainment: "#e74c3c",
  Other: "#95a5a6",
};

type Period = "today" | "week" | "month" | "year";

function formatSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDay(day: string, period: Period): string {
  if (!day) return "";
  const parts = day.split("-");
  if (parts.length < 3) return day;
  if (period === "year" || period === "month") {
    return `${parts[2]}.${parts[1]}`;
  }
  return `${parts[2]}.${parts[1]}`;
}

export default function StatsPage() {
  const [tab, setTab] = useState<Period>("today");

  // Today data
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [topApps, setTopApps] = useState<ActivitySummary[]>([]);

  // Period data
  const [dailyTime, setDailyTime] = useState<DailyTotal[]>([]);
  const [dailyBreaks, setDailyBreaks] = useState<DailyBreaks[]>([]);
  const [breakStats, setBreakStats] = useState<PeriodBreakStats | null>(null);
  const [waterTotal, setWaterTotal] = useState(0);
  const [dailyWater, setDailyWater] = useState<DailyWater[]>([]);

  useEffect(() => {
    if (tab === "today") {
      invoke<CategorySummary[]>("get_category_summary_today").then(setCategories);
      invoke<ActivitySummary[]>("get_activity_today").then((apps) => setTopApps(apps.slice(0, 5)));
    }
    // Always load period stats
    invoke<PeriodBreakStats>("get_break_stats_period", { period: tab }).then(setBreakStats);
    invoke<number>("get_water_period", { period: tab }).then(setWaterTotal);

    if (tab !== "today") {
      invoke<DailyTotal[]>("get_daily_totals_period", { period: tab }).then(setDailyTime);
      invoke<DailyBreaks[]>("get_daily_breaks_period", { period: tab }).then(setDailyBreaks);
      invoke<DailyWater[]>("get_daily_water", { period: tab }).then(setDailyWater);
    }
  }, [tab]);

  const tabs: { key: Period; label: string }[] = [
    { key: "today", label: t("stats.today") },
    { key: "week", label: t("stats.week") },
    { key: "month", label: t("stats.month") },
    { key: "year", label: t("stats.year") },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-2">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-1.5 rounded text-sm transition-colors ${
              tab === tb.key ? "bg-accent text-white" : "bg-card text-text-muted hover:text-text"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {/* Breaks summary */}
        <Card>
          <h3 className="text-text-muted text-xs mb-2">{t("stats.breaks")}</h3>
          {breakStats ? (
            <div className="space-y-1">
              <div className="text-2xl font-bold text-accent">{breakStats.taken}</div>
              <div className="text-xs text-text-muted">
                {t("stats.taken_label")}: {breakStats.taken} &nbsp;|&nbsp; {t("stats.skipped_label")}: {breakStats.skipped}
              </div>
              {breakStats.by_type.length > 0 && (
                <div className="mt-2 space-y-1">
                  {breakStats.by_type.map((bt) => (
                    <div key={bt.break_type} className="flex justify-between text-xs">
                      <span className="text-text-muted">{bt.break_type}</span>
                      <span className="text-text">{bt.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-text-muted text-sm py-4">{t("stats.no_data")}</div>
          )}
        </Card>

        {/* Water summary */}
        <Card>
          <h3 className="text-text-muted text-xs mb-2">{t("stats.water")}</h3>
          <div className="text-2xl font-bold text-blue-400">{waterTotal}</div>
          <div className="text-xs text-text-muted">{t("stats.glasses")}</div>
        </Card>

        {/* Work time summary (today only) */}
        {tab === "today" && (
          <Card>
            <h3 className="text-text-muted text-xs mb-2">{t("stats.work_time")}</h3>
            {categories.length > 0 ? (
              <div className="text-2xl font-bold text-accent">
                {formatSec(categories.reduce((sum, c) => sum + c.total_sec, 0))}
              </div>
            ) : (
              <div className="text-text-muted text-sm py-4">{t("stats.no_data")}</div>
            )}
          </Card>
        )}
        {tab !== "today" && (
          <Card>
            <h3 className="text-text-muted text-xs mb-2">{t("stats.work_time")}</h3>
            {dailyTime.length > 0 ? (
              <div className="text-2xl font-bold text-accent">
                {formatSec(dailyTime.reduce((sum, d) => sum + d.total_sec, 0))}
              </div>
            ) : (
              <div className="text-text-muted text-sm py-4">{t("stats.no_data")}</div>
            )}
          </Card>
        )}
      </div>

      {/* Today-specific: categories + top apps */}
      {tab === "today" && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <h3 className="text-text-muted text-xs mb-3">{t("stats.categories")}</h3>
            {categories.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="total_sec"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ category }) => category}
                  >
                    {categories.map((entry) => (
                      <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category] || "#95a5a6"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: number) => formatSec(val)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-text-muted text-sm text-center py-8">{t("stats.no_data")}</div>
            )}
          </Card>

          <Card>
            <h3 className="text-text-muted text-xs mb-3">{t("stats.top_apps")}</h3>
            <div className="space-y-2">
              {topApps.map((app) => (
                <div key={app.process_name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[app.category] || "#95a5a6" }}
                    />
                    <span className="text-sm truncate max-w-[150px]">{app.process_name}</span>
                  </div>
                  <span className="text-text-muted text-xs">{formatSec(app.total_sec)}</span>
                </div>
              ))}
              {topApps.length === 0 && (
                <div className="text-text-muted text-sm text-center py-4">{t("stats.no_data")}</div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Period charts: work time + breaks + water */}
      {tab !== "today" && (
        <div className="space-y-4">
          {/* Daily work time chart */}
          <Card>
            <h3 className="text-text-muted text-xs mb-3">{t("stats.work_time_chart")}</h3>
            {dailyTime.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dailyTime}>
                  <XAxis dataKey="day" tick={{ fill: "#8892a4", fontSize: 10 }} tickFormatter={(v) => formatDay(v, tab)} />
                  <YAxis tick={{ fill: "#8892a4", fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 3600)}h`} />
                  <Tooltip formatter={(val: number) => formatSec(val)} labelFormatter={(v) => formatDay(v, tab)} />
                  <Bar dataKey="total_sec" fill="#2ecc71" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-text-muted text-sm text-center py-8">{t("stats.no_data")}</div>
            )}
          </Card>

          {/* Daily breaks chart */}
          <Card>
            <h3 className="text-text-muted text-xs mb-3">{t("stats.breaks_chart")}</h3>
            {dailyBreaks.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dailyBreaks}>
                  <XAxis dataKey="day" tick={{ fill: "#8892a4", fontSize: 10 }} tickFormatter={(v) => formatDay(v, tab)} />
                  <YAxis tick={{ fill: "#8892a4", fontSize: 11 }} />
                  <Tooltip labelFormatter={(v) => formatDay(v, tab)} />
                  <Bar dataKey="count" fill="#2ecc71" name={t("stats.taken_label")} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="skipped_count" fill="#e74c3c" name={t("stats.skipped_label")} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-text-muted text-sm text-center py-8">{t("stats.no_data")}</div>
            )}
          </Card>

          {/* Daily water chart */}
          <Card>
            <h3 className="text-text-muted text-xs mb-3">{t("stats.water_chart")}</h3>
            {dailyWater.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dailyWater}>
                  <XAxis dataKey="day" tick={{ fill: "#8892a4", fontSize: 10 }} tickFormatter={(v) => formatDay(v, tab)} />
                  <YAxis tick={{ fill: "#8892a4", fontSize: 11 }} />
                  <Tooltip labelFormatter={(v) => formatDay(v, tab)} />
                  <Bar dataKey="glasses" fill="#3b82f6" name={t("stats.glasses")} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-text-muted text-sm text-center py-8">{t("stats.no_data")}</div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
