import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
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

      {/* Break intervals */}
      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.breaks_section")}</h3>
        <div className="space-y-3">
          <SliderField
            label={t("settings.small_break_every")}
            value={form.small_break_interval_min}
            min={5} max={120}
            unit={t("settings.unit_min")}
            disabled={!isCustom}
            onChange={(v) => update("small_break_interval_min", v)}
          />
          <SliderField
            label={t("settings.small_break_duration")}
            value={form.small_break_duration_sec}
            min={10} max={1800} step={10}
            unit={t("settings.unit_sec")}
            disabled={!isCustom}
            onChange={(v) => update("small_break_duration_sec", v)}
          />
          <SliderField
            label={t("settings.big_break_every")}
            value={form.big_break_interval_min}
            min={15} max={300}
            unit={t("settings.unit_min")}
            disabled={!isCustom}
            onChange={(v) => update("big_break_interval_min", v)}
          />
          <SliderField
            label={t("settings.big_break_duration")}
            value={form.big_break_duration_min}
            min={1} max={30}
            unit={t("settings.unit_min")}
            disabled={!isCustom}
            onChange={(v) => update("big_break_duration_min", v)}
          />

          {/* Break mode */}
          <div>
            <label className="text-xs text-text-muted">{t("settings.break_mode")}</label>
            <div className="flex gap-3 mt-1">
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
          </div>
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

      {/* Eye exercises */}
      <Card>
        <h3 className="text-sm font-medium mb-3">{t("settings.eye_section")}</h3>
        <SliderField
          label={t("settings.small_break_every")}
          value={form.eye_exercise_interval_min}
          min={10} max={120}
          unit={t("settings.unit_min")}
          disabled={!isCustom}
          onChange={(v) => update("eye_exercise_interval_min", v)}
        />
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
          <div className="flex items-center gap-3">
            <Checkbox
              label={t("settings.auto_update")}
              checked={form.auto_update}
              onChange={(v) => update("auto_update", v)}
            />
            {!form.auto_update && (
              <button
                onClick={() => open("https://github.com/JarekSaternus/HealthDesk/releases/latest")}
                className="text-xs text-accent hover:text-accent-hover underline cursor-pointer"
              >
                {t("settings.check_now")}
              </button>
            )}
          </div>
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
