import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useAppStore } from "../stores/appStore";
import { t } from "../i18n";
import Card from "../components/Card";
import type { WorkMethodPreset } from "../types";

const METHODS = ["pomodoro", "20-20-20", "52-17", "90-min", "custom"];

export default function SettingsPage() {
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const [saved, setSaved] = useState(false);
  const [methods, setMethods] = useState<Record<string, WorkMethodPreset>>({});
  const [form, setForm] = useState(config!);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "downloading" | "installing" | "up_to_date" | "error">("idle");
  const [updateVersion, setUpdateVersion] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateObj, setUpdateObj] = useState<any>(null);

  useEffect(() => {
    invoke<Record<string, WorkMethodPreset>>("get_work_methods").then(setMethods);
  }, []);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const update = (key: string, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    await saveConfig(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const isCustom = form.work_method === "custom";

  return (
    <div className="flex flex-col h-full max-w-2xl">
    <div className="space-y-4 flex-1 overflow-y-auto pb-4">
      {/* Dashboard layout */}
      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.dashboard_layout")}</h3>
        <div className="flex gap-3">
          {(["enhanced", "compact"] as const).map((layout) => (
            <label key={layout} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="dashboard_layout"
                checked={form.dashboard_layout === layout}
                onChange={() => update("dashboard_layout", layout)}
                className="accent-accent"
              />
              {t(`settings.layout_${layout}`)}
            </label>
          ))}
        </div>
      </Card>

      {/* Work method */}
      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.work_method")}</h3>
        <select
          value={form.work_method}
          onChange={(e) => update("work_method", e.target.value)}
          className="w-full bg-content border border-card-hover rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`settings.method_${m.replace("-", "_").replace("-", "_")}`)}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted mt-2">
          {t(`settings.method_${form.work_method.replace("-", "_").replace("-", "_")}_desc`)}
        </p>
      </Card>

      {/* Break intervals — only visible for custom method */}
      {isCustom && (
        <Card>
          <h3 className="text-sm font-medium mb-3">{t("settings.breaks_section")}</h3>
          <div className="space-y-3">
            <SliderField
              label={t("settings.small_break_every")}
              value={form.small_break_interval_min}
              min={5} max={120}
              unit={t("settings.unit_min")}
              onChange={(v) => update("small_break_interval_min", v)}
            />
            <SliderField
              label={t("settings.small_break_duration")}
              value={form.small_break_duration_sec}
              min={10} max={1800} step={10}
              unit={t("settings.unit_sec")}
              onChange={(v) => update("small_break_duration_sec", v)}
            />
            <SliderField
              label={t("settings.big_break_every")}
              value={form.big_break_interval_min}
              min={15} max={300}
              unit={t("settings.unit_min")}
              onChange={(v) => update("big_break_interval_min", v)}
            />
            <SliderField
              label={t("settings.big_break_duration")}
              value={form.big_break_duration_min}
              min={1} max={30}
              unit={t("settings.unit_min")}
              onChange={(v) => update("big_break_duration_min", v)}
            />
          </div>
        </Card>
      )}

      {/* Break mode — always visible */}
      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.break_mode")}</h3>
        <div className="flex gap-3">
          {(["moderate", "aggressive"] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="break_mode"
                checked={form.break_mode === mode}
                onChange={() => update("break_mode", mode)}
                className="accent-accent"
              />
              {t(`settings.mode_${mode}`)}
            </label>
          ))}
        </div>
      </Card>

      {/* Hydration */}
      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.hydration_section")}</h3>
        <div className="space-y-3">
          <SliderField
            label={t("settings.reminder_every")}
            value={form.water_interval_min}
            min={10} max={120}
            unit={t("settings.unit_min")}
            onChange={(v) => update("water_interval_min", v)}
          />
          <SliderField
            label={t("settings.daily_goal")}
            value={form.water_daily_goal}
            min={1} max={20}
            unit={t("settings.unit_glasses")}
            onChange={(v) => update("water_daily_goal", v)}
          />
        </div>
      </Card>

      {/* Eye exercises — only visible for custom method */}
      {isCustom && (
        <Card>
          <h3 className="text-sm font-medium mb-3">{t("settings.eye_section")}</h3>
          <SliderField
            label={t("settings.small_break_every")}
            value={form.eye_exercise_interval_min}
            min={10} max={120}
            unit={t("settings.unit_min")}
            onChange={(v) => update("eye_exercise_interval_min", v)}
          />
        </Card>
      )}

      {/* Breathing exercise */}
      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.breathing_section")}</h3>
        <Checkbox
          label={t("settings.breathing_enabled")}
          checked={form.breathing_exercise_enabled}
          onChange={(v) => update("breathing_exercise_enabled", v)}
        />
        {form.breathing_exercise_enabled && (
          <div className="mt-3">
            <SliderField
              label={t("settings.breathing_every")}
              value={form.breathing_exercise_interval_min}
              min={15} max={120}
              unit={t("settings.unit_min")}
              onChange={(v) => update("breathing_exercise_interval_min", v)}
            />
          </div>
        )}
      </Card>

      {/* Work hours */}
      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.work_hours_section")}</h3>
        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.work_hours_enabled}
            onChange={(e) => update("work_hours_enabled", e.target.checked)}
            className="accent-accent"
          />
          {t("settings.work_hours_only")}
        </label>
        {form.work_hours_enabled && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">{t("settings.from_hour")}</span>
            <input
              type="time"
              value={form.work_hours_start}
              onChange={(e) => update("work_hours_start", e.target.value)}
              className="bg-content border border-card-hover rounded px-2 py-1 text-sm text-text"
            />
            <span className="text-xs text-text-muted">{t("settings.to_hour")}</span>
            <input
              type="time"
              value={form.work_hours_end}
              onChange={(e) => update("work_hours_end", e.target.value)}
              className="bg-content border border-card-hover rounded px-2 py-1 text-sm text-text"
            />
          </div>
        )}
      </Card>

      {/* Sound & Privacy & System */}
      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.sound_section")}</h3>
        <Checkbox
          label={t("settings.sound_on_break")}
          checked={form.sound_notifications}
          onChange={(v) => update("sound_notifications", v)}
        />
        <Checkbox
          label={t("settings.audio_autoplay")}
          checked={form.audio_autoplay}
          onChange={(v) => update("audio_autoplay", v)}
        />
      </Card>

      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.privacy_section")}</h3>
        <div className="space-y-2">
          <Checkbox
            label={t("settings.telemetry")}
            desc={t("settings.telemetry_desc")}
            checked={form.telemetry_enabled}
            onChange={(v) => update("telemetry_enabled", v)}
          />
          <Checkbox
            label={t("settings.track_titles")}
            desc={t("settings.track_titles_desc")}
            checked={form.track_window_titles}
            onChange={(v) => update("track_window_titles", v)}
          />
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.system_section")}</h3>
        <div className="space-y-2">
          <Checkbox
            label={t("settings.autostart")}
            checked={form.autostart}
            onChange={(v) => update("autostart", v)}
          />
          <Checkbox
            label={t("settings.auto_update")}
            checked={form.auto_update}
            onChange={(v) => update("auto_update", v)}
          />
          <UpdateChecker
            status={updateStatus}
            version={updateVersion}
            progress={downloadProgress}
            onCheck={async () => {
              setUpdateStatus("checking");
              try {
                const update = await check();
                if (update) {
                  setUpdateVersion(update.version);
                  setUpdateObj(update);
                  setUpdateStatus("available");
                } else {
                  setUpdateStatus("up_to_date");
                  setTimeout(() => setUpdateStatus("idle"), 3000);
                }
              } catch {
                setUpdateStatus("error");
                setTimeout(() => setUpdateStatus("idle"), 3000);
              }
            }}
            onDownload={async () => {
              if (!updateObj) return;
              setUpdateStatus("downloading");
              let downloaded = 0;
              let total = 0;
              await updateObj.downloadAndInstall((event: any) => {
                if (event.event === "Started") {
                  total = event.data.contentLength || 0;
                } else if (event.event === "Progress") {
                  downloaded += event.data.chunkLength || 0;
                  if (total > 0) setDownloadProgress(Math.round((downloaded / total) * 100));
                } else if (event.event === "Finished") {
                  setUpdateStatus("installing");
                }
              });
              await relaunch();
            }}
          />
          <div>
            <label className="text-xs text-text-muted">{t("settings.language")}</label>
            <select
              value={form.language}
              onChange={(e) => update("language", e.target.value)}
              className="ml-3 bg-content border border-card-hover rounded px-2 py-1 text-sm text-text"
            >
              <option value="pl">Polski</option>
              <option value="en">English</option>
            </select>
            <span className="text-xs text-text-muted ml-2">{t("settings.language_restart")}</span>
          </div>
        </div>
      </Card>
    </div>

    {/* Sticky footer */}
    <div className="sticky bottom-0 bg-content pt-3 pb-1 border-t border-card-hover flex items-center gap-4">
      <button
        onClick={handleSave}
        className="bg-accent hover:bg-accent-hover text-white rounded px-6 py-2 text-sm font-medium transition-colors"
      >
        {saved ? t("settings.saved") : t("settings.save")}
      </button>
      <span className="text-xs text-text-muted">HealthDesk v{APP_VERSION}</span>
    </div>
    </div>
  );
}

function SliderField({
  label, value, min, max, step = 1, unit, disabled = false, onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  unit: string; disabled?: boolean; onChange: (v: number) => void;
}) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="flex justify-between text-xs text-text-muted mb-1">
        <span>{label}</span>
        <span>{value} {unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

function Checkbox({
  label, desc, checked, onChange,
}: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent mt-0.5"
      />
      <div>
        <span className="text-sm">{label}</span>
        {desc && <p className="text-xs text-text-muted">{desc}</p>}
      </div>
    </label>
  );
}

function UpdateChecker({
  status, version, progress, onCheck, onDownload,
}: {
  status: string; version: string; progress: number;
  onCheck: () => void; onDownload: () => void;
}) {
  if (status === "idle") {
    return (
      <button onClick={onCheck} className="text-xs text-accent hover:text-accent-hover underline cursor-pointer">
        {t("settings.check_now")}
      </button>
    );
  }
  if (status === "checking") {
    return <span className="text-xs text-text-muted">{t("update.checking")}</span>;
  }
  if (status === "available") {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-accent">{t("update.available", { version })}</span>
        <button onClick={onDownload} className="text-xs bg-accent hover:bg-accent-hover text-white rounded px-3 py-1">
          {t("update.download")}
        </button>
      </div>
    );
  }
  if (status === "downloading") {
    return <span className="text-xs text-text-muted">{t("update.downloading", { percent: String(progress) })}</span>;
  }
  if (status === "installing") {
    return <span className="text-xs text-accent">{t("update.installing")}</span>;
  }
  if (status === "up_to_date") {
    return <span className="text-xs text-accent">{t("update.up_to_date", { version: APP_VERSION })}</span>;
  }
  if (status === "error") {
    return <span className="text-xs text-danger">{t("update.error")}</span>;
  }
  return null;
}
