import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { t, loadTranslations } from "../i18n";
import type { AppConfig, WorkMethodPreset } from "../types";

const TOTAL_STEPS = 5;

const LANGUAGES = [
  { code: "pl", label: "Polski" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "pt-BR", label: "Português (BR)" },
  { code: "it", label: "Italiano" },
  { code: "tr", label: "Türkçe" },
  { code: "ru", label: "Русский" },
  { code: "ja", label: "日本語" },
  { code: "zh-CN", label: "简体中文" },
  { code: "ko", label: "한국어" },
];

const METHODS = [
  { key: "pomodoro", icon: "🍅", small: 25, big: 100, eye: 25 },
  { key: "20-20-20", icon: "👁", small: 20, big: 60, eye: 30 },
  { key: "52-17", icon: "⏱", small: 52, big: 52, eye: 52 },
  { key: "90-min", icon: "🧘", small: 90, big: 270, eye: 30 },
];

const SOUNDS = [
  { type: "brown_noise", icon: "🟤", labelKey: "onboarding.audio_brown_noise" },
  { type: "rain", icon: "🌧", labelKey: "onboarding.audio_rain" },
  { type: "white_noise", icon: "🌊", labelKey: "onboarding.audio_white_noise" },
  { type: "drone", icon: "🎵", labelKey: "onboarding.audio_drone" },
  { type: "forest", icon: "🌲", labelKey: "onboarding.audio_forest" },
];

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const config = useAppStore((s) => s.config)!;
  const saveConfig = useAppStore((s) => s.saveConfig);
  const [step, setStep] = useState(1);
  const [, setLangVer] = useState(0);

  // Form state
  const [language, setLanguage] = useState(config.language);
  const [workMethod, setWorkMethod] = useState("pomodoro");
  const [waterInterval, setWaterInterval] = useState(30);
  const [waterGoal, setWaterGoal] = useState(8);
  const [breathingEnabled, setBreathingEnabled] = useState(true);
  const [breathingInterval, setBreathingInterval] = useState(45);
  const [workHoursEnabled, setWorkHoursEnabled] = useState(false);
  const [workHoursStart, setWorkHoursStart] = useState("08:00");
  const [workHoursEnd, setWorkHoursEnd] = useState("18:00");
  const [breakMode, setBreakMode] = useState<"gentle" | "moderate" | "aggressive">("moderate");
  const [audioType, setAudioType] = useState<string | null>(null);
  const [audioAutoplay, setAudioAutoplay] = useState(true);
  const [autostart, setAutostart] = useState(true);

  const handleLanguageChange = async (lang: string) => {
    setLanguage(lang);
    await invoke("change_language", { lang });
    await loadTranslations();
    setLangVer((v) => v + 1);
    useAppStore.setState((s) => ({ langVersion: s.langVersion + 1 }));
  };

  const handleFinish = async () => {
    const updated: AppConfig = {
      ...config,
      language,
      work_method: workMethod,
      water_interval_min: waterInterval,
      water_daily_goal: waterGoal,
      breathing_exercise_enabled: breathingEnabled,
      breathing_exercise_interval_min: breathingInterval,
      work_hours_enabled: workHoursEnabled,
      work_hours_start: workHoursStart,
      work_hours_end: workHoursEnd,
      break_mode: breakMode,
      audio_autoplay: audioAutoplay,
      audio_last_type: audioType,
      audio_last_source: audioType ? "native" : null,
      audio_last_name: audioType ? (SOUNDS.find((s) => s.type === audioType)?.type ?? null) : null,
      autostart,
      onboarding_completed: true,
    };
    await saveConfig(updated);
    // Start audio if selected
    if (audioType) {
      try {
        await invoke("play_sound", { soundType: audioType, volume: 10 });
      } catch {}
    }
    onComplete();
  };

  const methodPreset = METHODS.find((m) => m.key === workMethod)!;

  return (
    <div className="flex items-center justify-center h-screen bg-content">
      <div className="w-full max-w-lg mx-4">
        {/* Progress */}
        <div className="flex items-center justify-between mb-6">
          <span className="text-xs text-text-muted">
            {t("onboarding.step_of", { current: String(step), total: String(TOTAL_STEPS) })}
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`h-1.5 w-8 rounded-full transition-colors ${
                  i < step ? "bg-accent" : "bg-card-hover"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="bg-card rounded-xl p-6 shadow-lg min-h-[420px] flex flex-col">
          {step === 1 && (
            <Step1Language
              language={language}
              onChange={handleLanguageChange}
            />
          )}
          {step === 2 && (
            <Step2Method
              selected={workMethod}
              onChange={setWorkMethod}
            />
          )}
          {step === 3 && (
            <Step3Wellness
              waterInterval={waterInterval}
              waterGoal={waterGoal}
              breathingEnabled={breathingEnabled}
              breathingInterval={breathingInterval}
              workHoursEnabled={workHoursEnabled}
              workHoursStart={workHoursStart}
              workHoursEnd={workHoursEnd}
              onWaterInterval={setWaterInterval}
              onWaterGoal={setWaterGoal}
              onBreathingEnabled={setBreathingEnabled}
              onBreathingInterval={setBreathingInterval}
              onWorkHoursEnabled={setWorkHoursEnabled}
              onWorkHoursStart={setWorkHoursStart}
              onWorkHoursEnd={setWorkHoursEnd}
            />
          )}
          {step === 4 && (
            <Step4Comfort
              breakMode={breakMode}
              audioType={audioType}
              audioAutoplay={audioAutoplay}
              autostart={autostart}
              onBreakMode={setBreakMode}
              onAudioType={setAudioType}
              onAudioAutoplay={setAudioAutoplay}
              onAutostart={setAutostart}
            />
          )}
          {step === 5 && (
            <Step5Summary
              workMethod={workMethod}
              methodPreset={methodPreset}
              waterInterval={waterInterval}
              waterGoal={waterGoal}
              breathingEnabled={breathingEnabled}
              breathingInterval={breathingInterval}
              breakMode={breakMode}
              audioType={audioType}
              autostart={autostart}
            />
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-auto pt-4">
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="text-text-muted hover:text-text text-sm px-4 py-2 transition-colors"
              >
                ← {t("onboarding.back")}
              </button>
            ) : (
              <div />
            )}
            {step < TOTAL_STEPS ? (
              <button
                onClick={() => setStep(step + 1)}
                className="bg-accent hover:bg-accent-hover text-white rounded px-6 py-2 text-sm font-medium transition-colors"
              >
                {t("onboarding.next")} →
              </button>
            ) : (
              <button
                onClick={handleFinish}
                className="bg-accent hover:bg-accent-hover text-white rounded px-6 py-2 text-sm font-medium transition-colors"
              >
                🚀 {t("onboarding.start")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================== STEP 1: Language ==================== */

function Step1Language({ language, onChange }: { language: string; onChange: (lang: string) => void }) {
  return (
    <>
      <h2 className="text-xl font-bold text-accent mb-1">{t("onboarding.welcome_title")}</h2>
      <p className="text-sm text-text-muted mb-5">{t("onboarding.welcome_desc")}</p>
      <h3 className="text-sm font-medium mb-3">{t("onboarding.select_language")}</h3>
      <div className="grid grid-cols-3 gap-2">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => onChange(lang.code)}
            className={`text-sm px-3 py-2 rounded border transition-colors ${
              language === lang.code
                ? "border-accent bg-accent/10 text-accent"
                : "border-card-hover bg-content text-text hover:border-text-muted"
            }`}
          >
            {lang.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* ==================== STEP 2: Work Method ==================== */

function Step2Method({ selected, onChange }: { selected: string; onChange: (m: string) => void }) {
  return (
    <>
      <h2 className="text-xl font-bold text-accent mb-1">{t("onboarding.method_title")}</h2>
      <p className="text-sm text-text-muted mb-4">{t("onboarding.method_subtitle")}</p>
      <div className="space-y-2 flex-1">
        {METHODS.map((m) => {
          const tKey = `onboarding.method_${m.key.replace(/-/g, "_")}_short`;
          return (
            <button
              key={m.key}
              onClick={() => onChange(m.key)}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                selected === m.key
                  ? "border-accent bg-accent/10"
                  : "border-card-hover bg-content hover:border-text-muted"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{m.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {t(`settings.method_${m.key.replace(/-/g, "_")}`)}
                    </span>
                    {m.key === "pomodoro" && (
                      <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                        {t("onboarding.recommended")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">{t(tKey)}</p>
                </div>
              </div>
              {/* Mini timeline */}
              <div className="mt-2 flex items-center gap-1 ml-8">
                <TimelineBar minutes={m.small} label={`${m.small}m`} color="bg-accent/40" />
                <TimelineBar minutes={3} label="" color="bg-yellow-500/40" />
                <TimelineBar minutes={m.small} label={`${m.small}m`} color="bg-accent/40" />
                {m.big !== m.small && (
                  <>
                    <span className="text-[9px] text-text-muted mx-0.5">...</span>
                    <TimelineBar minutes={5} label="" color="bg-orange-500/40" />
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function TimelineBar({ minutes, label, color }: { minutes: number; label: string; color: string }) {
  const w = Math.max(16, Math.min(80, minutes * 1.2));
  return (
    <div className="flex flex-col items-center">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${w}px` }} />
      {label && <span className="text-[8px] text-text-muted mt-0.5">{label}</span>}
    </div>
  );
}

/* ==================== STEP 3: Wellness ==================== */

function Step3Wellness({
  waterInterval, waterGoal, breathingEnabled, breathingInterval,
  workHoursEnabled, workHoursStart, workHoursEnd,
  onWaterInterval, onWaterGoal, onBreathingEnabled, onBreathingInterval,
  onWorkHoursEnabled, onWorkHoursStart, onWorkHoursEnd,
}: {
  waterInterval: number; waterGoal: number;
  breathingEnabled: boolean; breathingInterval: number;
  workHoursEnabled: boolean; workHoursStart: string; workHoursEnd: string;
  onWaterInterval: (v: number) => void; onWaterGoal: (v: number) => void;
  onBreathingEnabled: (v: boolean) => void; onBreathingInterval: (v: number) => void;
  onWorkHoursEnabled: (v: boolean) => void; onWorkHoursStart: (v: string) => void; onWorkHoursEnd: (v: string) => void;
}) {
  return (
    <>
      <h2 className="text-xl font-bold text-accent mb-4">{t("onboarding.wellness_title")}</h2>

      {/* Water */}
      <div className="mb-4">
        <h3 className="text-sm font-medium mb-2">💧 {t("onboarding.water_section")}</h3>
        <OnbSlider label={t("settings.reminder_every")} value={waterInterval} min={10} max={120} unit={t("settings.unit_min")} onChange={onWaterInterval} />
        <OnbSlider label={t("settings.daily_goal")} value={waterGoal} min={1} max={20} unit={t("settings.unit_glasses")} onChange={onWaterGoal} />
      </div>

      {/* Breathing */}
      <div className="mb-4">
        <h3 className="text-sm font-medium mb-2">🫁 {t("onboarding.breathing_section")}</h3>
        <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
          <input type="checkbox" checked={breathingEnabled} onChange={(e) => onBreathingEnabled(e.target.checked)} className="accent-accent" />
          {t("settings.breathing_enabled")}
        </label>
        {breathingEnabled && (
          <OnbSlider label={t("settings.breathing_every")} value={breathingInterval} min={15} max={120} unit={t("settings.unit_min")} onChange={onBreathingInterval} />
        )}
      </div>

      {/* Work hours */}
      <div>
        <h3 className="text-sm font-medium mb-2">⏰ {t("onboarding.work_hours_section")}</h3>
        <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
          <input type="checkbox" checked={workHoursEnabled} onChange={(e) => onWorkHoursEnabled(e.target.checked)} className="accent-accent" />
          {t("onboarding.work_hours_limit")}
        </label>
        {workHoursEnabled && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">{t("settings.from_hour")}</span>
            <input type="time" value={workHoursStart} onChange={(e) => onWorkHoursStart(e.target.value)}
              className="bg-content border border-card-hover rounded px-2 py-1 text-sm text-text" />
            <span className="text-xs text-text-muted">{t("settings.to_hour")}</span>
            <input type="time" value={workHoursEnd} onChange={(e) => onWorkHoursEnd(e.target.value)}
              className="bg-content border border-card-hover rounded px-2 py-1 text-sm text-text" />
          </div>
        )}
      </div>
    </>
  );
}

/* ==================== STEP 4: Comfort ==================== */

function Step4Comfort({
  breakMode, audioType, audioAutoplay, autostart,
  onBreakMode, onAudioType, onAudioAutoplay, onAutostart,
}: {
  breakMode: string; audioType: string | null; audioAutoplay: boolean; autostart: boolean;
  onBreakMode: (v: "gentle" | "moderate" | "aggressive") => void;
  onAudioType: (v: string | null) => void;
  onAudioAutoplay: (v: boolean) => void;
  onAutostart: (v: boolean) => void;
}) {
  const BREAK_MODES = [
    { key: "gentle" as const, icon: "🕊", descKey: "onboarding.break_mode_gentle_desc" },
    { key: "moderate" as const, icon: "🛡", descKey: "onboarding.break_mode_moderate_desc" },
    { key: "aggressive" as const, icon: "🔒", descKey: "onboarding.break_mode_aggressive_desc" },
  ];

  const handlePreview = async (type: string) => {
    try {
      await invoke("stop_sound");
      await invoke("play_sound", { soundType: type, volume: 10 });
    } catch {}
  };

  const handleSelectSound = async (type: string | null) => {
    if (type === audioType) {
      // Deselect — stop preview
      onAudioType(null);
      try { await invoke("stop_sound"); } catch {}
    } else {
      onAudioType(type);
      if (type) await handlePreview(type);
    }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-accent mb-4">{t("onboarding.comfort_title")}</h2>

      {/* Break mode */}
      <div className="mb-4">
        <h3 className="text-sm font-medium mb-2">{t("onboarding.break_mode_section")}</h3>
        <div className="space-y-1.5">
          {BREAK_MODES.map((mode) => (
            <button
              key={mode.key}
              onClick={() => onBreakMode(mode.key)}
              className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
                breakMode === mode.key
                  ? "border-accent bg-accent/10"
                  : "border-card-hover bg-content hover:border-text-muted"
              }`}
            >
              <span className="mr-2">{mode.icon}</span>
              <span className="font-medium">{t(`settings.mode_${mode.key}`)}</span>
              <p className="text-xs text-text-muted ml-6 mt-0.5">{t(mode.descKey)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Audio */}
      <div className="mb-4">
        <h3 className="text-sm font-medium mb-2">🎵 {t("onboarding.audio_section")}</h3>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {SOUNDS.map((s) => (
            <button
              key={s.type}
              onClick={() => handleSelectSound(s.type)}
              className={`text-center px-2 py-2 rounded border text-xs transition-colors ${
                audioType === s.type
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-card-hover bg-content text-text hover:border-text-muted"
              }`}
            >
              <div className="text-lg mb-0.5">{s.icon}</div>
              {t(s.labelKey)}
            </button>
          ))}
          <button
            onClick={() => handleSelectSound(null)}
            className={`text-center px-2 py-2 rounded border text-xs transition-colors ${
              audioType === null
                ? "border-accent bg-accent/10 text-accent"
                : "border-card-hover bg-content text-text hover:border-text-muted"
            }`}
          >
            <div className="text-lg mb-0.5">🔇</div>
            {t("onboarding.audio_none")}
          </button>
        </div>
        {audioType && (
          <label className="flex items-center gap-2 text-xs cursor-pointer text-text-muted">
            <input type="checkbox" checked={audioAutoplay} onChange={(e) => onAudioAutoplay(e.target.checked)} className="accent-accent" />
            {t("onboarding.audio_autoplay_label")}
          </label>
        )}
      </div>

      {/* Autostart */}
      <div>
        <h3 className="text-sm font-medium mb-2">🚀 {t("onboarding.autostart_section")}</h3>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={autostart} onChange={(e) => onAutostart(e.target.checked)} className="accent-accent" />
          {t("onboarding.autostart_label")}
        </label>
      </div>
    </>
  );
}

/* ==================== STEP 5: Summary ==================== */

function Step5Summary({
  workMethod, methodPreset, waterInterval, waterGoal,
  breathingEnabled, breathingInterval, breakMode, audioType, autostart,
}: {
  workMethod: string; methodPreset: { key: string; small: number; big: number; eye: number };
  waterInterval: number; waterGoal: number;
  breathingEnabled: boolean; breathingInterval: number;
  breakMode: string; audioType: string | null; autostart: boolean;
}) {
  const methodName = t(`settings.method_${workMethod.replace(/-/g, "_")}`);
  const modeName = t(`settings.mode_${breakMode}`);
  const audioName = audioType
    ? t(`onboarding.audio_${audioType}`)
    : t("onboarding.summary_audio_off");

  const rows = [
    [t("onboarding.summary_method"), methodName],
    [
      t("onboarding.summary_breaks"),
      `${t("onboarding.summary_small_every", { min: String(methodPreset.small) })}, ${t("onboarding.summary_big_every", { min: String(methodPreset.big) })}`,
    ],
    [t("onboarding.summary_eyes"), t("onboarding.summary_every", { min: String(methodPreset.eye) })],
    [
      t("onboarding.summary_breathing"),
      breathingEnabled
        ? t("onboarding.summary_every", { min: String(breathingInterval) })
        : t("onboarding.summary_off"),
    ],
    [
      t("onboarding.summary_water"),
      t("onboarding.summary_water_detail", { min: String(waterInterval), goal: String(waterGoal) }),
    ],
    [t("onboarding.summary_break_mode"), modeName],
    [t("onboarding.summary_audio"), audioName],
    [t("onboarding.summary_autostart"), autostart ? t("onboarding.summary_yes") : t("onboarding.summary_no")],
  ];

  return (
    <>
      <h2 className="text-xl font-bold text-accent mb-4">{t("onboarding.summary_title")}</h2>
      <div className="space-y-2 flex-1">
        {rows.map(([label, value], i) => (
          <div key={i} className="flex justify-between text-sm py-1.5 border-b border-card-hover last:border-0">
            <span className="text-text-muted">{label}</span>
            <span className="text-text font-medium text-right">{value}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-text-muted text-center mt-3">
        💡 {t("onboarding.summary_hint")}
      </p>
    </>
  );
}

/* ==================== Shared slider ==================== */

function OnbSlider({
  label, value, min, max, step = 1, unit, onChange,
}: {
  label: string; value: number; min: number; max: number;
  step?: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-text-muted mb-1">
        <span>{label}</span>
        <span>{value} {unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
