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
  organizer: string | null;
  description: string | null;
  meet_link: string | null;
}

interface TimelineEvent {
  type: string;
  time: number; // minutes from midnight
  color: string;
  label: string;
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
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
  meetings: MeetingBlock[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (!schedulerState) return events;

  const types = [
    { key: "small_break", interval: eff.small_break_interval_min, timer: schedulerState.time_to_small_break, color: "#3498db", label: t("home.small_break") },
    { key: "big_break", interval: eff.big_break_interval_min, timer: schedulerState.time_to_big_break, color: "#e67e22", label: t("home.big_break") },
    { key: "water", interval: eff.water_interval_min, timer: schedulerState.time_to_water, color: "#5dade2", label: t("home.water") },
    { key: "eye", interval: eff.eye_exercise_interval_min, timer: schedulerState.time_to_eye, color: "#9b59b6", label: t("settings.eye_section") },
  ];

  if (eff.breathing_exercise_enabled) {
    types.push({
      key: "breathing", interval: eff.breathing_exercise_interval_min,
      timer: schedulerState.time_to_breathing, color: "#2ecc71",
      label: t("settings.breathing_section"),
    });
  }

  for (const { key, interval, timer, color, label } of types) {
    const nextMin = nowMin + timer / 60;
    let eventMin = nextMin;
    while (eventMin <= endMin) {
      if (eventMin >= startMin) {
        // Always hide breaks that overlap with meetings on the timeline
        const duringMeeting = meetings.some(
          (m) => eventMin >= m.startMin && eventMin < m.endMin
        );
        if (!duringMeeting) {
          events.push({ type: key, time: eventMin, color, label });
        }
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
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingBlock | null>(null);
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
        organizer: ev.organizer,
        description: ev.description,
        meet_link: ev.meet_link,
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

  const events = generateEvents(startMin, endMin, nowMin, eff, schedulerState, meetings);
  const nowPct = Math.max(0, Math.min(100, ((nowMin - startMin) / totalRange) * 100));

  // Generate hour markers
  const hours: number[] = [];
  for (let h = Math.ceil(startMin / 60); h * 60 <= endMin; h++) {
    hours.push(h);
  }

  return (
    <div className="mt-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-text-muted">{t("home.timeline")}</span>
        <div className="flex flex-wrap gap-1">
          {[
            { color: "#3498db", label: t("home.small_break") },
            { color: "#e67e22", label: t("home.big_break") },
            { color: "#5dade2", label: t("home.water") },
            { color: "#9b59b6", label: t("settings.eye_section") },
            ...(eff.breathing_exercise_enabled ? [{ color: "#2ecc71", label: t("settings.breathing_section") }] : []),
          ].map(({ color, label }) => (
            <span
              key={color}
              className="text-[10px] px-1.5 py-0 rounded-full"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {label}
            </span>
          ))}
        </div>
        <span className="text-xs text-text-muted ml-auto">
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
              <span className="absolute top-0 text-[11px] text-text-muted/60 -translate-x-1/2">
                {h}
              </span>
            </div>
          );
        })}

        {/* Meeting blocks — z-[5] so they're above break bars and clickable */}
        {meetings.map((m, i) => {
          const leftPct = Math.max(0, ((m.startMin - startMin) / totalRange) * 100);
          const rightPct = Math.min(100, ((m.endMin - startMin) / totalRange) * 100);
          const widthPct = rightPct - leftPct;
          if (widthPct <= 0) return null;
          const meetingTitle = `${m.summary}\n${minutesToHHMM(m.startMin)}–${minutesToHHMM(m.endMin)}${m.organizer ? `\n${m.organizer}` : ""}`;
          return (
            <div
              key={`meeting-${i}`}
              className="absolute top-0.5 bottom-0.5 rounded opacity-30 hover:opacity-60 transition-opacity cursor-pointer z-[5]"
              style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: "#e74c3c" }}
              title={meetingTitle}
              onClick={() => setSelectedMeeting(selectedMeeting?.summary === m.summary ? null : m)}
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
              className="absolute top-4 bottom-1 w-[3px] rounded-full opacity-80 hover:opacity-100 transition-opacity"
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

      {/* Meeting detail popup */}
      {selectedMeeting && (
        <div className="mt-1.5 p-2.5 bg-card-hover rounded-lg border border-red-500/20 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium text-white">{selectedMeeting.summary}</div>
            <button
              className="text-text-muted hover:text-white text-sm leading-none"
              onClick={() => setSelectedMeeting(null)}
            >
              ✕
            </button>
          </div>
          <div className="text-text-muted mt-1">
            {minutesToHHMM(selectedMeeting.startMin)}–{minutesToHHMM(selectedMeeting.endMin)}
            <span className="ml-2 text-text-muted/60">
              ({Math.round(selectedMeeting.endMin - selectedMeeting.startMin)} min)
            </span>
          </div>
          {selectedMeeting.organizer && (
            <div className="mt-1 text-text-muted">
              {t("settings.calendar_select") ? "👤" : "👤"} {selectedMeeting.organizer}
            </div>
          )}
          {selectedMeeting.description && (
            <div className="mt-1 text-text-muted/80 whitespace-pre-line line-clamp-3">
              {selectedMeeting.description}
            </div>
          )}
          {selectedMeeting.meet_link && (
            <a
              href={selectedMeeting.meet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
              onClick={(e) => {
                e.preventDefault();
                invoke("plugin:shell|open", { path: selectedMeeting.meet_link });
              }}
            >
              🔗 Google Meet
            </a>
          )}
        </div>
      )}

    </div>
  );
}