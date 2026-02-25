import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t } from "../i18n";
import { useAppStore } from "../stores/appStore";

export default function WaterReminder() {
  const [waterToday, setWaterToday] = useState(0);
  const [remaining, setRemaining] = useState(30);
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    invoke<number>("get_water_today").then(setWaterToday);
    invoke("get_config").then(setConfig);

    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleLater();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    invoke("play_chime").catch(() => {});
    return () => clearInterval(timer);
  }, []);

  const handleDrank = async () => {
    await invoke("log_water", { glasses: 1 });
    await invoke("popup_closed");
    const win = getCurrentWebviewWindow();
    await win.close();
  };

  const handleLater = async () => {
    await invoke("popup_closed");
    const win = getCurrentWebviewWindow();
    await win.close();
  };

  const waterGoal = config?.water_daily_goal ?? 8;
  const goalReached = waterToday >= waterGoal;

  return (
    <div className="h-screen bg-content flex flex-col items-center justify-center p-6 select-none">
      <div className="text-4xl mb-3">💧</div>
      <h1 className="text-info text-lg font-bold mb-2">{t("water.time_to_drink")}</h1>

      {/* Water dots */}
      <div className="flex gap-1.5 mb-3">
        {Array.from({ length: waterGoal }, (_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full ${
              i < waterToday ? "bg-info" : "bg-card-hover"
            }`}
          />
        ))}
      </div>

      <p className="text-text-muted text-sm mb-1">
        {t("water.glasses_count", { current: String(waterToday), goal: String(waterGoal) })}
      </p>
      {goalReached && (
        <p className="text-accent text-xs mb-4">{t("water.goal_reached")}</p>
      )}

      <div className="text-text-muted text-xs mb-4">{remaining}s</div>

      <div className="flex gap-3">
        <button
          onClick={handleDrank}
          className="bg-info hover:bg-info/80 text-white rounded px-6 py-2 text-sm font-medium"
        >
          {t("water.drank")}
        </button>
        <button
          onClick={handleLater}
          className="bg-card hover:bg-card-hover text-text-muted rounded px-6 py-2 text-sm"
        >
          {t("water.later")}
        </button>
      </div>
    </div>
  );
}
