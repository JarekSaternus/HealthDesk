import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t } from "../i18n";

type Phase = "inhale" | "hold-in" | "exhale" | "hold-out";

const PHASE_DURATION = 4;
const TOTAL_CYCLES = 5;

const PHASES: Phase[] = ["inhale", "hold-in", "exhale", "hold-out"];

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "inhale": return t("exercise.breathing.inhale");
    case "hold-in": return t("exercise.breathing.hold");
    case "exhale": return t("exercise.breathing.exhale");
    case "hold-out": return t("exercise.breathing.hold");
  }
}

function phaseScale(phase: Phase): number {
  switch (phase) {
    case "inhale": return 1.0;
    case "hold-in": return 1.0;
    case "exhale": return 0.6;
    case "hold-out": return 0.6;
  }
}

export default function BreathingExercise() {
  const [cycle, setCycle] = useState(1);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [countdown, setCountdown] = useState(PHASE_DURATION);
  const [scale, setScale] = useState(0.6);
  const closingRef = useRef(false);

  const phase = PHASES[phaseIndex];

  useEffect(() => {
    // Set initial scale with a small delay to trigger the transition
    requestAnimationFrame(() => {
      setScale(phaseScale(PHASES[0]));
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Move to next phase
          setPhaseIndex((pi) => {
            const next = pi + 1;
            if (next >= PHASES.length) {
              // End of cycle
              setCycle((c) => {
                if (c >= TOTAL_CYCLES) {
                  clearInterval(timer);
                  if (!closingRef.current) {
                    closingRef.current = true;
                    handleClose();
                  }
                  return c;
                }
                // Start new cycle
                setScale(phaseScale(PHASES[0]));
                return c + 1;
              });
              return 0;
            }
            setScale(phaseScale(PHASES[next]));
            return next;
          });
          return PHASE_DURATION;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleClose = async () => {
    await invoke("popup_closed");
    const win = getCurrentWebviewWindow();
    await win.close();
  };

  return (
    <div className="h-screen bg-content flex flex-col items-center justify-center p-6 select-none">
      <h1 className="text-accent text-lg font-bold mb-6">{t("exercise.breathing.title")}</h1>

      <div className="relative flex items-center justify-center mb-6" style={{ width: 180, height: 180 }}>
        <div
          className="absolute rounded-full"
          style={{
            width: 160,
            height: 160,
            background: "radial-gradient(circle, rgba(46,204,113,0.3) 0%, rgba(46,204,113,0.08) 70%, transparent 100%)",
            transform: `scale(${scale})`,
            transition: phase === "hold-in" || phase === "hold-out"
              ? "none"
              : `transform ${PHASE_DURATION}s ease-in-out`,
          }}
        />
        <div className="relative z-10 text-center">
          <div className="text-text text-sm mb-1">{phaseLabel(phase)}</div>
          <div className="text-accent text-3xl font-mono font-bold">{countdown}</div>
        </div>
      </div>

      <div className="text-text-muted text-sm mb-4">
        {t("exercise.breathing.cycle", { current: String(cycle), total: String(TOTAL_CYCLES) })}
      </div>

      <button
        onClick={handleClose}
        className="bg-card hover:bg-card-hover text-text-muted rounded px-6 py-2 text-sm"
      >
        {t("exercise.breathing.close")}
      </button>
    </div>
  );
}
