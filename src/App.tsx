import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useAppStore } from "./stores/appStore";
import { loadTranslations } from "./i18n";
import { t } from "./i18n";
import Sidebar from "./components/Sidebar";
import BottomBar from "./components/BottomBar";
import HomePage from "./pages/HomePage";
import StatsPage from "./pages/StatsPage";
import MusicPage from "./pages/MusicPage";
import SettingsPage from "./pages/SettingsPage";
import HelpPage from "./pages/HelpPage";
import BreakWindow from "./windows/BreakWindow";
import BreakFullscreen from "./windows/BreakFullscreen";
import EyeExercise from "./windows/EyeExercise";
import StretchExercise from "./windows/StretchExercise";
import WaterReminder from "./windows/WaterReminder";
import BreathingExercise from "./windows/BreathingExercise";

function UpdateModal({ version, onClose }: { version: string; onClose: () => void }) {
  const [status, setStatus] = useState<"prompt" | "downloading" | "installing">("prompt");
  const [progress, setProgress] = useState(0);
  const [updateObj, setUpdateObj] = useState<any>(null);

  useEffect(() => {
    check().then((update) => {
      if (update) setUpdateObj(update);
    }).catch(() => {});
  }, []);

  const handleDownload = async () => {
    if (!updateObj) return;
    setStatus("downloading");
    let downloaded = 0;
    let total = 0;
    await updateObj.downloadAndInstall((event: any) => {
      if (event.event === "Started") {
        total = event.data.contentLength || 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength || 0;
        if (total > 0) setProgress(Math.round((downloaded / total) * 100));
      } else if (event.event === "Finished") {
        setStatus("installing");
      }
    });
    await relaunch();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h2 className="text-accent text-lg font-bold mb-2">{t("update.title")}</h2>

        {status === "prompt" && (
          <>
            <p className="text-text text-sm mb-1">{t("update.available", { version })}</p>
            <p className="text-text-muted text-xs mb-4">{t("update.restart_note")}</p>
            <div className="flex gap-3">
              <button
                onClick={handleDownload}
                className="bg-accent hover:bg-accent-hover text-white rounded px-4 py-2 text-sm font-medium flex-1"
              >
                {t("update.download")}
              </button>
              <button
                onClick={onClose}
                className="bg-card-hover hover:bg-content text-text-muted rounded px-4 py-2 text-sm flex-1"
              >
                {t("update.later")}
              </button>
            </div>
          </>
        )}

        {status === "downloading" && (
          <>
            <p className="text-text-muted text-sm mb-3">{t("update.downloading", { percent: String(progress) })}</p>
            <div className="w-full h-2 bg-card-hover rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </>
        )}

        {status === "installing" && (
          <p className="text-accent text-sm">{t("update.installing")}</p>
        )}
      </div>
    </div>
  );
}

function MainLayout() {
  const currentPage = useAppStore((s) => s.currentPage);
  // Subscribe to langVersion to force re-render when language changes
  useAppStore((s) => s.langVersion);

  const renderPage = () => {
    switch (currentPage) {
      case "home": return <HomePage />;
      case "stats": return <StatsPage />;
      case "music": return <MusicPage />;
      case "settings": return <SettingsPage />;
      case "help": return <HelpPage />;
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          {renderPage()}
        </main>
        <BottomBar />
      </div>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const loadConfig = useAppStore((s) => s.loadConfig);
  const initListeners = useAppStore((s) => s.initListeners);

  useEffect(() => {
    const isPopup = window.location.pathname !== "/";
    (async () => {
      try {
        await loadTranslations();
        await loadConfig();
        if (!isPopup) {
          await initListeners();
          // Auto-resume music if enabled
          try {
            const cfg = useAppStore.getState().config;
            if (cfg?.audio_autoplay && cfg.audio_last_type) {
              const vol = cfg.audio_last_volume ?? 10;
              if (cfg.audio_last_source === "youtube") {
                await invoke("play_youtube_search", { query: cfg.audio_last_type, volume: vol });
              } else {
                await invoke("play_sound", { soundType: cfg.audio_last_type, volume: vol });
              }
            }
          } catch (e) {
            console.warn("Auto-resume audio failed:", e);
          }
          // Auto-check for updates after 3 seconds
          setTimeout(async () => {
            try {
              const cfg = useAppStore.getState().config;
              if (cfg?.auto_update === false) return;
              const update = await check();
              if (update) {
                setUpdateAvailable(update.version);
              }
            } catch (e) {
              console.warn("Update check failed:", e);
            }
          }, 3000);
        }
        setReady(true);
      } catch (err) {
        console.error("Init failed:", err);
        setError(String(err));
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-content gap-4">
        <div className="text-red-400 text-xl">Błąd inicjalizacji</div>
        <div className="text-gray-400 text-sm max-w-md text-center">{error}</div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-content">
        <div className="text-accent text-xl">HealthDesk</div>
      </div>
    );
  }

  // Check if this is a popup window (has path params)
  const path = window.location.pathname;
  if (path.startsWith("/break-fullscreen")) return <BreakFullscreen />;
  if (path.startsWith("/break")) return <BreakWindow />;
  if (path.startsWith("/eye-exercise")) return <EyeExercise />;
  if (path.startsWith("/stretch-exercise")) return <StretchExercise />;
  if (path.startsWith("/breathing-exercise")) return <BreathingExercise />;
  if (path.startsWith("/water-reminder")) return <WaterReminder />;

  return (
    <>
      <MainLayout />
      {updateAvailable && (
        <UpdateModal
          version={updateAvailable}
          onClose={() => setUpdateAvailable(null)}
        />
      )}
    </>
  );
}
