import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t, tRaw } from "../i18n";

interface Exercise {
  name: string;
  icon: string;
  desc: string;
}

export default function StretchExercise() {
  const exercises = (tRaw("exercise.stretch.exercises") || []) as Exercise[];
  const [exercise] = useState(() =>
    exercises.length > 0
      ? exercises[Math.floor(Math.random() * exercises.length)]
      : null
  );

  const handleDone = async () => {
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
      <h1 className="text-accent text-lg font-bold mb-1">{t("exercise.stretch.title")}</h1>
      <h2 className="text-text text-sm mb-4">{exercise.name}</h2>

      <pre className="text-text-muted text-sm whitespace-pre-wrap font-sans leading-relaxed mb-4 text-center max-w-sm">
        {exercise.desc}
      </pre>

      <p className="text-xs text-text-muted italic mb-6">{t("exercise.stretch.tip")}</p>

      <button
        onClick={handleDone}
        className="bg-accent hover:bg-accent-hover text-white rounded px-6 py-2 text-sm font-medium"
      >
        {t("exercise.stretch.done")}
      </button>
    </div>
  );
}
