import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadTranslations } from "../i18n";
import type { AppConfig, SchedulerState, Page } from "../types";

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
    if (!state) return;
    await invoke("toggle_pause", { paused: !state.paused });
  },

  initListeners: async () => {
    await listen<SchedulerState>("scheduler:state-update", (event) => {
      set({ schedulerState: event.payload });
    });

    await listen("water:logged", () => {
      get().refreshWater();
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
