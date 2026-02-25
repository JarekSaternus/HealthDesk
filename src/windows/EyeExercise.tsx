import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t, tRaw } from "../i18n";

interface Exercise {
  name: string;
  icon: string;
  steps: string[];
  duration: number;
}

export default function EyeExercise() {
  const exercises = (tRaw("exercise.eye.exercises") || []) as Exercise[];
  const [exercise] = useState(() =>
    exercises.length > 0
      ? exercises[Math.floor(Math.random() * exercises.length)]
      : null
  );
  const [remaining, setRemaining] = useState(exercise?.duration ?? 30);

  useEffect(() => {
    if (!exercise) return;
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [exercise]);

  const handleClose = async () => {
    await invoke("popup_closed");
    const win = getCurrentWebviewWindow();
    await win.close();
  };

  if (!exercise) {
    return (
      <div className="h-screen bg-content flex items-center justify-center">
        <p className="text-text-muted">No exercises available</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-content flex flex-col items-center justify-center p-6 select-none">
      <div className="text-4xl mb-2">{exercise.icon}</div>
      <h1 className="text-accent text-lg font-bold mb-1">{t("exercise.eye.title")}</h1>
      <h2 className="text-text text-sm mb-4">{exercise.name}</h2>

      <div className="space-y-2 mb-6">
        {exercise.steps.map((step, i) => (
          <div key={i} className="text-text-muted text-sm flex gap-2">
            <span className="text-accent">{i + 1}.</span>
            <span>{step}</span>
          </div>
        ))}
      </div>

      <div className="text-2xl font-mono text-text mb-4">{remaining}s</div>

      <button
        onClick={handleClose}
        className="bg-card hover:bg-card-hover text-text-muted rounded px-6 py-2 text-sm"
      >
        {t("exercise.eye.close")}
      </button>
    </div>
  );
}
