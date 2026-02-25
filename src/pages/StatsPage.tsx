import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { t } from "../i18n";
import Card from "../components/Card";
import type { CategorySummary, ActivitySummary, DailyTotal, DailyBreaks } from "../types";

const CATEGORY_COLORS: Record<string, string> = {
  Work: "#2ecc71",
  Browser: "#3498db",
  Communication: "#9b59b6",
  Entertainment: "#e74c3c",
  Other: "#95a5a6",
};

function formatSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function StatsPage() {
  const [tab, setTab] = useState<"today" | "week">("today");
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [topApps, setTopApps] = useState<ActivitySummary[]>([]);
  const [weeklyTime, setWeeklyTime] = useState<DailyTotal[]>([]);
  const [weeklyBreaks, setWeeklyBreaks] = useState<DailyBreaks[]>([]);

  useEffect(() => {
    if (tab === "today") {
      invoke<CategorySummary[]>("get_category_summary_today").then(setCategories);
      invoke<ActivitySummary[]>("get_activity_today").then((apps) => setTopApps(apps.slice(0, 5)));
    } else {
      invoke<DailyTotal[]>("get_weekly_daily_totals").then(setWeeklyTime);
      invoke<DailyBreaks[]>("get_weekly_breaks").then(setWeeklyBreaks);
    }
  }, [tab]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setTab("today")}
          className={`px-4 py-1.5 rounded text-sm transition-colors ${
            tab === "today" ? "bg-accent text-white" : "bg-card text-text-muted hover:text-text"
          }`}
        >
          {t("stats.today")}
        </button>
        <button
          onClick={() => setTab("week")}
          className={`px-4 py-1.5 rounded text-sm transition-colors ${
            tab === "week" ? "bg-accent text-white" : "bg-card text-text-muted hover:text-text"
          }`}
        >
          {t("stats.week")}
        </button>
      </div>

      {tab === "today" ? (
        <div className="grid grid-cols-2 gap-4">
          {/* Category pie chart */}
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
              <div className="text-text-muted text-sm text-center py-8">No data</div>
            )}
          </Card>

          {/* Top apps */}
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
                <div className="text-text-muted text-sm text-center py-4">No data</div>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Weekly work time */}
          <Card>
            <h3 className="text-text-muted text-xs mb-3">{t("stats.work_time_7days")}</h3>
            {weeklyTime.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklyTime}>
                  <XAxis dataKey="day" tick={{ fill: "#8892a4", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#8892a4", fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 3600)}h`} />
                  <Tooltip formatter={(val: number) => formatSec(val)} />
                  <Bar dataKey="total_sec" fill="#2ecc71" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-text-muted text-sm text-center py-8">{t("stats.no_data_week")}</div>
            )}
          </Card>

          {/* Weekly breaks */}
          <Card>
            <h3 className="text-text-muted text-xs mb-3">{t("stats.breaks_7days")}</h3>
            {weeklyBreaks.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklyBreaks}>
                  <XAxis dataKey="day" tick={{ fill: "#8892a4", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#8892a4", fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2ecc71" name="Taken" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="skipped_count" fill="#e74c3c" name="Skipped" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-text-muted text-sm text-center py-8">{t("stats.no_data_week")}</div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
