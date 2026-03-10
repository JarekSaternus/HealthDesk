import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t } from "../i18n";

export default function PreMeetingReminder() {
  const params = new URLSearchParams(window.location.search);
  const summary = params.get("summary") || "Meeting";
  const start = params.get("start") || "";
  const end = params.get("end") || "";
  const organizer = params.get("organizer");
  const description = params.get("description");
  const meetLink = params.get("meet_link");

  const [remaining, setRemaining] = useState(30);

  const startTime = start ? new Date(start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const endTime = end ? new Date(end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const durationMin = start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000) : 0;

  useEffect(() => {
    invoke("get_config").then((cfg: any) => {
      if (cfg?.sound_notifications) invoke("play_chime").catch(() => {});
    }).catch(() => {});

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
  }, []);

  const handleClose = async () => {
    try { await getCurrentWebviewWindow().close(); } catch (e) { console.warn(e); }
  };

  const handleOpenMeet = async () => {
    if (meetLink) {
      try { await invoke("plugin:shell|open", { path: meetLink }); } catch (e) { console.warn(e); }
    }
  };

  return (
    <div className="h-screen bg-content flex flex-col items-center justify-center p-6 select-none">
      <div className="text-4xl mb-2">📅</div>
      <h1 className="text-red-400 text-lg font-bold mb-1">
        {t("pre_meeting_title") || "Meeting in 5 minutes"}
      </h1>

      <div className="text-white text-base font-medium mb-2 text-center">{summary}</div>

      <div className="text-text-muted text-sm mb-1">
        {startTime}–{endTime}
        {durationMin > 0 && <span className="ml-1.5 text-text-muted/60">({durationMin} min)</span>}
      </div>

      {organizer && (
        <div className="text-text-muted text-xs mb-1">👤 {organizer}</div>
      )}

      {description && (
        <div className="text-text-muted/70 text-xs mb-2 text-center max-w-[320px] line-clamp-2">
          {description}
        </div>
      )}

      <div className="text-text-muted text-[10px] mb-3">{remaining}s</div>

      <div className="flex gap-2">
        {meetLink && (
          <button
            onClick={handleOpenMeet}
            className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded px-4 py-1.5 text-sm font-medium transition-colors"
          >
            🔗 {t("pre_meeting_join") || "Google Meet"}
          </button>
        )}
        <button
          onClick={handleClose}
          className="bg-card hover:bg-card-hover text-text-muted rounded px-4 py-1.5 text-sm transition-colors"
        >
          {t("pre_meeting_dismiss") || "OK"}
        </button>
      </div>
    </div>
  );
}
