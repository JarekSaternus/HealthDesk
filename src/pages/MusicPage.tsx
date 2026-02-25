import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import Card from "../components/Card";
import { useAppStore } from "../stores/appStore";
import type { YTStation, YTSearchResult } from "../types";

const NATIVE_SOUNDS = [
  { key: "brown_noise", name: "Brown Noise", icon: "🟤" },
  { key: "rain", name: "Rain", icon: "🌧️" },
  { key: "white_noise", name: "White Noise", icon: "⬜" },
  { key: "pink_noise", name: "Pink Noise", icon: "🩷" },
  { key: "drone", name: "Ambient Drone", icon: "🎵" },
  { key: "forest", name: "Forest", icon: "🌲" },
];

export default function MusicPage() {
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const [nativePlaying, setNativePlaying] = useState<string | null>(null);
  const [ytPlaying, setYtPlaying] = useState<string | null>(null);
  const [volume, setVolume] = useState(config?.audio_last_volume ?? 10);
  const [ytStations, setYtStations] = useState<YTStation[]>([]);
  const [customUrl, setCustomUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YTSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    invoke<YTStation[]>("get_youtube_stations").then(setYtStations);
    // Check current audio state
    invoke<{ playing: boolean; current_type: string | null }>("get_audio_state").then((s) => {
      if (s.playing && s.current_type) setNativePlaying(s.current_type);
    });
    invoke<{ playing: boolean; current_station: string | null }>("get_youtube_state").then((s) => {
      if (s.playing && s.current_station) setYtPlaying(s.current_station);
    });
  }, []);

  const playNative = async (key: string) => {
    await invoke("stop_youtube");
    setYtPlaying(null);
    if (nativePlaying === key) {
      await invoke("stop_sound");
      setNativePlaying(null);
    } else {
      await invoke("play_sound", { soundType: key, volume });
      setNativePlaying(key);
    }
  };

  const playYt = async (query: string, name: string) => {
    await invoke("stop_sound");
    setNativePlaying(null);
    setLoading(true);
    setStatus(t("music.connecting"));
    try {
      await invoke("play_youtube_search", { query, volume });
      setYtPlaying(name);
      setStatus(t("music.playing", { name }));
    } catch (e: any) {
      setStatus(t("music.error", { msg: String(e) }));
    }
    setLoading(false);
  };

  const playYtUrl = async () => {
    if (!customUrl) return;
    await invoke("stop_sound");
    setNativePlaying(null);
    setLoading(true);
    setStatus(t("music.connecting"));
    try {
      await invoke("play_youtube", { url: customUrl, name: t("music.custom_link_name"), volume });
      setYtPlaying(t("music.custom_link_name"));
      setStatus(t("music.playing", { name: t("music.custom_link_name") }));
    } catch (e: any) {
      setStatus(t("music.error", { msg: String(e) }));
    }
    setLoading(false);
  };

  const stopAll = async () => {
    await invoke("stop_sound");
    await invoke("stop_youtube");
    setNativePlaying(null);
    setYtPlaying(null);
    setStatus("");
  };

  const handleVolumeChange = async (v: number) => {
    setVolume(v);
    await invoke("set_sound_volume", { volume: v });
    if (config) {
      saveConfig({ ...config, audio_last_volume: v });
    }
  };

  const doSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const results = await invoke<YTSearchResult[]>("search_youtube_cmd", { query: searchQuery });
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {/* Native sounds */}
      <div>
        <h2 className="text-sm text-text-muted mb-2">{t("music.focus_sounds")}</h2>
        <p className="text-xs text-text-muted mb-3">{t("music.native_desc")}</p>
        <div className="grid grid-cols-3 gap-3">
          {NATIVE_SOUNDS.map((sound) => (
            <button
              key={sound.key}
              onClick={() => playNative(sound.key)}
              className={`p-4 rounded-lg text-center transition-colors ${
                nativePlaying === sound.key
                  ? "bg-accent/20 border border-accent"
                  : "bg-card hover:bg-card-hover"
              }`}
            >
              <div className="text-2xl mb-1">{sound.icon}</div>
              <div className="text-xs">{sound.name}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Volume */}
      <Card className="flex items-center gap-3">
        <span className="text-sm text-text-muted">{t("music.volume")}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-sm text-text-muted w-8">{volume}</span>
        <button
          onClick={stopAll}
          className="bg-danger/20 text-danger hover:bg-danger/30 rounded px-3 py-1 text-sm"
        >
          {t("music.stop_all")}
        </button>
      </Card>

      {/* YouTube Radio */}
      <div>
        <h2 className="text-sm text-text-muted mb-2">{t("music.yt_radio")}</h2>
        <p className="text-xs text-text-muted mb-3">{t("music.yt_desc")}</p>
        <div className="grid grid-cols-3 gap-3">
          {ytStations.map((station) => (
            <button
              key={station.key}
              onClick={() => playYt(station.query, station.name)}
              disabled={loading}
              className={`p-3 rounded-lg text-sm transition-colors ${
                ytPlaying === station.name
                  ? "bg-accent/20 border border-accent"
                  : "bg-card hover:bg-card-hover"
              }`}
            >
              {station.name}
            </button>
          ))}
        </div>
      </div>

      {/* Custom URL */}
      <Card>
        <label className="text-xs text-text-muted block mb-2">{t("music.custom_link_label")}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="flex-1 bg-content border border-card-hover rounded px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
          <button
            onClick={playYtUrl}
            disabled={loading || !customUrl}
            className="bg-accent hover:bg-accent-hover text-white rounded px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {t("music.play")}
          </button>
        </div>
      </Card>

      {/* Search */}
      <Card>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search YouTube..."
            className="flex-1 bg-content border border-card-hover rounded px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
          <button
            onClick={doSearch}
            disabled={loading}
            className="bg-card hover:bg-card-hover rounded px-4 py-1.5 text-sm"
          >
            {t("music.search")}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="space-y-1">
            {searchResults.map((r, i) => (
              <button
                key={i}
                onClick={() => {
                  invoke("stop_sound");
                  setNativePlaying(null);
                  setLoading(true);
                  invoke("play_youtube", { url: r.url, name: r.title, volume })
                    .then(() => { setYtPlaying(r.title); setStatus(t("music.playing", { name: r.title })); })
                    .catch((e) => setStatus(t("music.error", { msg: String(e) })))
                    .finally(() => setLoading(false));
                }}
                className="w-full text-left p-2 rounded hover:bg-card-hover text-sm flex justify-between"
              >
                <span className="truncate">{r.title}</span>
                <span className="text-text-muted text-xs ml-2">{r.duration}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {status && <div className="text-xs text-text-muted">{status}</div>}
    </div>
  );
}
