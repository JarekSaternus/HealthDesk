import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadTranslations } from "../i18n";
import type { AppConfig, CalendarEvent, SchedulerState, Page } from "../types";

interface AppStore {
  config: AppConfig | null;
  schedulerState: SchedulerState | null;
  currentPage: Page;
  waterToday: number;
  totalTimeToday: number;
  langVersion: number;

  setPage: (page: Page) => void;
  loadConfig: () => Promise<void>;
  saveConfig: (cfg: AppConfig) => Promise<void>;
  refreshWater: () => Promise<void>;
  refreshTotalTime: () => Promise<void>;
  logWater: () => Promise<void>;
  togglePause: () => Promise<void>;
  initListeners: () => Promise<void>;
}

export const useAppStore = create<AppStore>((set, get) => ({
  config: null,
  schedulerState: null,
  currentPage: "home",
  waterToday: 0,
  totalTimeToday: 0,
  langVersion: 0,

  setPage: (page) => set({ currentPage: page }),

  loadConfig: async () => {
    const config = await invoke<AppConfig>("get_config");
    set({ config });
  },

  saveConfig: async (cfg) => {
    const prevLang = get().config?.language;
    await invoke("save_config", { newConfig: cfg });
    set({ config: cfg });
    // Reload translations if language changed
    if (cfg.language !== prevLang) {
      await invoke("change_language", { lang: cfg.language });
      await loadTranslations();
      // Bump langVersion to force re-render of components using t()
      set((s) => ({ langVersion: s.langVersion + 1 }));
    }
  },

  refreshWater: async () => {
    const total = await invoke<number>("get_water_today");
    set({ waterToday: total });
  },

  refreshTotalTime: async () => {
    const total = await invoke<number>("get_total_time_today");
    set({ totalTimeToday: total });
  },

  logWater: async () => {
    await invoke("log_water", { glasses: 1 });
    const total = await invoke<number>("get_water_today");
    set({ waterToday: total });
  },

  togglePause: async () => {
    const state = get().schedulerState;
    const isPaused = state?.paused ?? false;
    const newPaused = !isPaused;
    await invoke("toggle_pause", { paused: newPaused });
    if (newPaused) {
      await invoke("pause_audio").catch(() => {});
      await invoke("pause_youtube").catch(() => {});
    } else {
      await invoke("resume_audio").catch(() => {});
      await invoke("resume_youtube").catch(() => {});
    }
  },

  initListeners: async () => {
    await listen<SchedulerState>("scheduler:state-update", (event) => {
      set({ schedulerState: event.payload });
    });

    await listen("water:logged", () => {
      get().refreshWater();
    });

    // Pre-meeting reminder — open popup window with meeting details
    await listen<CalendarEvent>("scheduler:pre-meeting", async (event) => {
      console.log("[Pre-meeting] Event received:", event.payload);
      const ev = event.payload;
      const params = new URLSearchParams({
        summary: ev.summary,
        start: ev.start,
        end: ev.end,
        ...(ev.organizer ? { organizer: ev.organizer } : {}),
        ...(ev.description ? { description: ev.description } : {}),
        ...(ev.meet_link ? { meet_link: ev.meet_link } : {}),
      });
      // Create popup window via Tauri WebviewWindow
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      new WebviewWindow("pre-meeting", {
        url: `/pre-meeting?${params.toString()}`,
        title: "HealthDesk - Meeting",
        width: 400,
        height: 300,
        center: true,
        alwaysOnTop: true,
        resizable: false,
      });
    });

    // Initial data load
    get().refreshWater();
    get().refreshTotalTime();

    // Refresh total time every 30s
    setInterval(() => {
      get().refreshTotalTime();
    }, 30000);
  },
}));
