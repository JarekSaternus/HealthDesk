import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAppStore } from "./stores/appStore";
import { loadTranslations } from "./i18n";
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

function MainLayout() {
  const currentPage = useAppStore((s) => s.currentPage);

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
  const loadConfig = useAppStore((s) => s.loadConfig);
  const initListeners = useAppStore((s) => s.initListeners);

  useEffect(() => {
    (async () => {
      await loadTranslations();
      await loadConfig();
      await initListeners();
      setReady(true);
    })();
  }, []);

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
  if (path.startsWith("/water-reminder")) return <WaterReminder />;

  return <MainLayout />;
}
