import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../stores/appStore";
import { t } from "../i18n";
import type { EffectiveIntervals, CalendarEvent, CalendarStateResponse } from "../types";

interface MeetingBlock {
  startMin: number;
  endMin: number;
  summary: string;
}

interface TimelineEvent {
  type: string;
  time: number; // minutes from midnight
  color: string;
  label: string;
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min) % 24;
  const m = Math.round((min % 1) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function parseTime(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function generateEvents(
  startMin: number,
  endMin: number,
  nowMin: number,
  eff: EffectiveIntervals,
  schedulerState: any,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (!schedulerState) return events;

  const types = [
    { key: "small_break", interval: eff.small_break_interval_min, timer: schedulerState.time_to_small_break, color: "#3498db", label: t("home.small_break") },
    { key: "big_break", interval: eff.big_break_interval_min, timer: schedulerState.time_to_big_break, color: "#e67e22", label: t("home.big_break") },
    { key: "water", interval: eff.water_interval_min, timer: schedulerState.time_to_water, color: "#2ecc71", label: t("home.water") },
    { key: "eye", interval: eff.eye_exercise_interval_min, timer: schedulerState.time_to_eye, color: "#9b59b6", label: t("settings.eye_section") },
  ];

  if (eff.breathing_exercise_enabled) {
    types.push({
      key: "breathing", interval: eff.breathing_exercise_interval_min,
      timer: schedulerState.time_to_breathing, color: "#1abc9c",
      label: t("settings.breathing_section"),
    });
  }

  for (const { key, interval, timer, color, label } of types) {
    // First upcoming event time
    const nextMin = nowMin + timer / 60;
    // Generate events from next occurrence until end of work day
    let eventMin = nextMin;
    while (eventMin <= endMin) {
      if (eventMin >= startMin) {
        events.push({ type: key, time: eventMin, color, label });
      }
      eventMin += interval;
    }
  }

  return events.sort((a, b) => a.time - b.time);
}

export default function DayTimeline() {
  const config = useAppStore((s) => s.config);
  const schedulerState = useAppStore((s) => s.schedulerState);
  const [eff, setEff] = useState<EffectiveIntervals | null>(null);
  const [meetings, setMeetings] = useState<MeetingBlock[]>([]);
  const [nowMin, setNowMin] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  useEffect(() => {
    invoke<EffectiveIntervals>("get_effective_intervals").then(setEff);
  }, [config?.weekly_schedule]);

  // Fetch calendar events
  useEffect(() => {
    invoke<CalendarStateResponse>("get_calendar_state").then((s) => {
      if (s.connected) parseMeetings(s.events);
    });
    const unlisten = listen<CalendarEvent[]>("calendar:events-updated", (ev) => {
      parseMeetings(ev.payload);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const parseMeetings = (events: CalendarEvent[]) => {
    setMeetings(events.map((ev) => {
      const s = new Date(ev.start);
      const e = new Date(ev.end);
      return {
        startMin: s.getHours() * 60 + s.getMinutes(),
        endMin: e.getHours() * 60 + e.getMinutes(),
        summary: ev.summary,
      };
    }));
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setNowMin(now.getHours() * 60 + now.getMinutes());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!config || !eff || !schedulerState) return null;

  const startMin = parseTime(config.work_hours_start ?? "08:00");
  const endMin = parseTime(config.work_hours_end ?? "18:00");
  const totalRange = endMin - startMin;
  if (totalRange <= 0) return null;

  const events = generateEvents(startMin, endMin, nowMin, eff, schedulerState);
  const nowPct = Math.max(0, Math.min(100, ((nowMin - startMin) / totalRange) * 100));

  // Generate hour markers
  const hours: number[] = [];
  for (let h = Math.ceil(startMin / 60); h * 60 <= endMin; h++) {
    hours.push(h);
  }

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-text-muted">{t("home.timeline")}</span>
        <span className="text-xs text-text-muted">
          {config.work_hours_start} — {config.work_hours_end}
        </span>
      </div>
      <div className="relative h-10 bg-card-hover rounded-lg overflow-hidden">
        {/* Hour markers */}
        {hours.map((h) => {
          const pct = ((h * 60 - startMin) / totalRange) * 100;
          return (
            <div key={h} className="absolute top-0 h-full" style={{ left: `${pct}%` }}>
              <div className="w-px h-full bg-content/50" />
              <span className="absolute -top-0.5 text-[9px] text-text-muted/50 -translate-x-1/2">
                {h}
              </span>
            </div>
          );
        })}

        {/* Meeting blocks */}
        {meetings.map((m, i) => {
          const leftPct = Math.max(0, ((m.startMin - startMin) / totalRange) * 100);
          const rightPct = Math.min(100, ((m.endMin - startMin) / totalRange) * 100);
          const widthPct = rightPct - leftPct;
          if (widthPct <= 0) return null;
          return (
            <div
              key={`meeting-${i}`}
              className="absolute top-0.5 bottom-0.5 rounded opacity-25 hover:opacity-40 transition-opacity"
              style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: "#e74c3c" }}
              title={`${m.summary} (${minutesToHHMM(m.startMin)}–${minutesToHHMM(m.endMin)})`}
            />
          );
        })}

        {/* Events */}
        {events.map((ev, i) => {
          const pct = ((ev.time - startMin) / totalRange) * 100;
          if (pct < 0 || pct > 100) return null;
          return (
            <div
              key={`${ev.type}-${i}`}
              className="absolute top-1 bottom-1 w-1.5 rounded-full opacity-70 hover:opacity-100 transition-opacity"
              style={{ left: `${pct}%`, backgroundColor: ev.color }}
              title={`${ev.label} — ${minutesToHHMM(ev.time)}`}
            />
          );
        })}

        {/* Now marker */}
        {nowPct >= 0 && nowPct <= 100 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-white/80 z-10"
            style={{ left: `${nowPct}%` }}
          >
            <div className="absolute -top-0.5 -translate-x-1/2 w-2 h-2 rounded-full bg-white" />
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-1.5">
        {[
          { color: "#3498db", label: t("home.small_break") },
          { color: "#e67e22", label: t("home.big_break") },
          { color: "#2ecc71", label: t("home.water") },
          { color: "#9b59b6", label: t("settings.eye_section") },
          ...(eff.breathing_exercise_enabled ? [{ color: "#1abc9c", label: t("settings.breathing_section") }] : []),
          ...(meetings.length > 0 ? [{ color: "#e74c3c", label: t("home.meetings") }] : []),
        ].map(({ color, label }) => (
          <div key={color} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
            <span className="text-[10px] text-text-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}