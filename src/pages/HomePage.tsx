import { useAppStore } from "../stores/appStore";
import HomeEnhanced from "./HomeEnhanced";
import HomeCompact from "./HomeCompact";

export default function HomePage() {
  const layout = useAppStore((s) => s.config?.dashboard_layout ?? "enhanced");

  if (layout === "compact") return <HomeCompact />;
  return <HomeEnhanced />;
}
