import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t } from "../i18n";

export default function BreakWindow() {
  const params = new URLSearchParams(window.location.search);
  const breakType = params.get("type") || "small";
  const duration = parseInt(params.get("duration") || "20", 10);
  const [remaining, setRemaining] = useState(duration);
  const [accepted, setAccepted] = useState(false);
  const [ad, setAd] = useState<any>(null);
  const closedRef = useRef(false);

  const closeWindow = async (skipped: boolean) => {
    if (closedRef.current) return;
    closedRef.current = true;
    try { await invoke("log_break", { breakType, durationSec: duration, skipped }); } catch (e) { console.warn("log_break failed:", e); }
    try { await invoke("popup_closed"); } catch (e) { console.warn("popup_closed failed:", e); }
    try { await getCurrentWebviewWindow().close(); } catch (e) { console.warn("close failed:", e); }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          closeWindow(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    invoke("get_ad", { clientUuid: "" }).then(setAd).catch(() => {});
    invoke("play_chime").catch(() => {});

    return () => clearInterval(timer);
  }, []);

  const handleAccept = () => setAccepted(true);
  const handleSkip = () => closeWindow(true);
  const handleSnooze = async () => {
    if (closedRef.current) return;
    closedRef.current = true;
    try { await invoke("snooze_break", { breakType, snoozeSec: 180 }); } catch (e) { console.warn("snooze failed:", e); }
    try { await getCurrentWebviewWindow().close(); } catch (e) { console.warn("close failed:", e); }
  };

  const progress = ((duration - remaining) / duration) * 100;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isSmall = breakType === "small";

  return (
    <div className="h-screen bg-content flex flex-col items-center justify-center p-6 select-none">
      <h1 className="text-accent text-xl font-bold mb-2">
        {isSmall ? t("break.small_title") : t("break.big_title")}
      </h1>
      <p className="text-text-muted text-sm text-center mb-6 whitespace-pre-line">
        {isSmall
          ? t("break.small_desc")
          : t("break.big_desc", { minutes: String(Math.ceil(duration / 60)) })}
      </p>

      {/* Timer */}
      <div className="text-4xl font-mono text-text mb-4">
        {minutes}:{seconds.toString().padStart(2, "0")}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xs h-2 bg-card rounded-full mb-6 overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Buttons */}
      {!accepted ? (
        <div className="flex gap-3">
          <button
            onClick={handleAccept}
            className="bg-accent hover:bg-accent-hover text-white rounded px-6 py-2 text-sm font-medium"
          >
            {t("break.accept")}
          </button>
          <button
            onClick={handleSnooze}
            className="bg-card hover:bg-card-hover text-text-muted rounded px-6 py-2 text-sm"
          >
            {t("break.snooze")}
          </button>
          <button
            onClick={handleSkip}
            className="bg-card hover:bg-card-hover text-text-muted rounded px-6 py-2 text-sm"
          >
            {t("break.skip")}
          </button>
        </div>
      ) : (
        <p className="text-accent text-sm">{t("break.accepted_msg")}</p>
      )}

      {/* Ad banner */}
      {ad && ad.title && (
        <div
          className="mt-4 p-3 rounded text-center text-xs cursor-pointer max-w-xs"
          style={{ backgroundColor: ad.bg_color, color: ad.text_color }}
          onClick={() => {
            invoke("report_ad_click", { adId: ad.ad_id, clientUuid: "" });
            window.open(ad.click_url);
          }}
        >
          <div className="font-medium">{ad.title}</div>
          <div className="opacity-80">{ad.description}</div>
        </div>
      )}
    </div>
  );
}
