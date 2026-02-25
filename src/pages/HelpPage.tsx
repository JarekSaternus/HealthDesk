import { t } from "../i18n";
import Card from "../components/Card";

export default function HelpPage() {
  const text = t("help.text");

  return (
    <Card>
      <h2 className="text-sm font-medium mb-3">{t("help.title")}</h2>
      <pre className="text-xs text-text-muted whitespace-pre-wrap font-sans leading-relaxed overflow-y-auto max-h-[calc(100vh-200px)]">
        {text}
      </pre>
    </Card>
  );
}
