import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, BatteryCharging, Zap } from "lucide-react";
import { toast } from "sonner";
import { useT, type TranslationKey } from "@/lib/i18n";
import { hasNativeOemSettings, openBatterySettings, openAutostartSettings } from "@/lib/background-location";
import { SectionHeading } from "@/components/section-heading";

export const Route = createFileRoute("/battery-guide")({
  head: () => ({
    meta: [
      { title: "Battery & Autostart — badiyos Expert" },
      { name: "description", content: "Keep job alerts and live location working on Xiaomi, Vivo, Oppo, Realme and Samsung phones." },
      { property: "og:title", content: "Battery & Autostart — badiyos Expert" },
      { property: "og:description", content: "Keep job alerts and live location working on your phone." },
    ],
  }),
  component: BatteryGuide,
});

const OEMS = ["xiaomi", "vivo", "oppo", "realme", "samsung"] as const;

function BatteryGuide() {
  const t = useT();
  const nativeSettings = hasNativeOemSettings();

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pb-[max(env(safe-area-inset-bottom),1rem)]">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-background px-6 pb-4 pt-[calc(var(--safe-top)+1.5rem)]">
        <Link to="/profile" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">{t("battery.title")}</h1>
      </header>

      <section className="px-6">
        <div className="rounded-[18px] border border-border bg-card p-4 card-lift">
          <div className="flex items-start gap-3">
            <div className="icon-tile flex h-10 w-10 items-center justify-center rounded-full">
              <BatteryCharging className="h-5 w-5 text-primary" />
            </div>
            <p className="flex-1 text-[14px] text-foreground">{t("battery.intro")}</p>
          </div>

          {nativeSettings ? (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void openBatterySettings().then((ok) => { if (!ok) toast.error(t("battery.manual")); });
                }}
                className="h-11 flex-1 rounded-[12px] bg-primary text-[13px] font-bold text-primary-foreground"
              >
                {t("battery.openBattery")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void openAutostartSettings().then((ok) => { if (!ok) toast.error(t("battery.manual")); });
                }}
                className="h-11 flex-1 rounded-[12px] border border-border bg-background text-[13px] font-bold text-foreground"
              >
                {t("battery.openAutostart")}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-[color:var(--text-secondary)]">{t("battery.manual")}</p>
          )}
        </div>
      </section>

      <section className="mt-6 px-6">
        <SectionHeading>{t("battery.title")}</SectionHeading>
        <ul className="mt-3 space-y-2">
          {OEMS.map((oem) => (
            <li key={oem} className="rounded-[14px] border border-border bg-card p-4 card-lift">
              <p className="flex items-center gap-2 text-[15px] font-bold text-foreground">
                <Zap className="h-4 w-4 text-primary" />
                {t(`battery.oem.${oem}` as TranslationKey)}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
                {t(`battery.oem.${oem}.steps` as TranslationKey)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
