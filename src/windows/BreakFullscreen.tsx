import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t } from "../i18n";

const MESSAGES = [
  "break_fs.msg_eyes",
  "break_fs.msg_health",
  "break_fs.msg_breathe",
  "break_fs.msg_relax",
  "break_fs.msg_halfway",
];

export default function BreakFullscreen() {
  const params = new URLSearchParams(window.location.search);
  const breakType = params.get("type") || "small";
  const duration = parseInt(params.get("duration") || "20", 10);
  const [remaining, setRemaining] = useState(duration);
  const [msgIdx, setMsgIdx] = useState(0);
  const clickTimes = useRef<number[]>([]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleDone(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    invoke("play_chime").catch(() => {});

    // Rotate messages every 10 seconds
    const msgTimer = setInterval(() => {
      setMsgIdx((prev) => (prev + 1) % MESSAGES.length);
    }, 10000);

    return () => {
      clearInterval(timer);
      clearInterval(msgTimer);
    };
  }, []);

  const handleDone = async (skipped: boolean) => {
    try { await invoke("log_break", { breakType, durationSec: duration, skipped }); } catch (e) { console.warn("log_break failed:", e); }
    try { await invoke("popup_closed"); } catch (e) { console.warn("popup_closed failed:", e); }
    try { await getCurrentWebviewWindow().close(); } catch (e) { console.warn("close failed:", e); }
  };

  const handleClick = () => {
    const now = Date.now();
    clickTimes.current.push(now);
    // Keep only clicks within last 2 seconds
    clickTimes.current = clickTimes.current.filter((t) => now - t < 2000);
    if (clickTimes.current.length >= 3) {
      handleDone(true);
    }
  };

  const progress = ((duration - remaining) / duration) * 100;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isSmall = breakType === "small";

  return (
    <div
      className="h-screen bg-black flex flex-col items-center justify-center select-none cursor-default"
      onClick={handleClick}
    >
      <h1 className="text-accent text-3xl font-bold mb-4">
        {isSmall ? t("break_fs.small_title") : t("break_fs.big_title")}
      </h1>
      <p className="text-gray-400 text-lg text-center mb-8 whitespace-pre-line max-w-lg">
        {isSmall ? t("break_fs.small_desc") : t("break_fs.big_desc")}
      </p>

      {/* Timer */}
      <div className="text-6xl font-mono text-white mb-6">
        {minutes}:{seconds.toString().padStart(2, "0")}
      </div>

      {/* Progress bar */}
      <div className="w-96 h-3 bg-gray-800 rounded-full mb-8 overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Motivational message */}
      <p className="text-gray-500 text-lg italic mb-12">
        {t(MESSAGES[msgIdx])}
      </p>

      {/* Exit hint */}
      <p className="text-gray-700 text-xs absolute bottom-8">
        {t("break_fs.exit_hint")}
      </p>
    </div>
  );
}
