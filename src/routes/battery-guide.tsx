import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, CheckCircle2, Circle, Zap } from "lucide-react";
import { toast } from "sonner";
import { useT, type TranslationKey } from "@/lib/i18n";
import { SectionHeading } from "@/components/section-heading";
import {
  getAlertSetupStatus,
  openAlertSetting,
  openOemSetting,
  markAlertSetupPrompted,
  type AlertSetupStatus,
  type OemSettingKind,
} from "@/lib/alert-setup";

export const Route = createFileRoute("/battery-guide")({
  head: () => ({
    meta: [
      { title: "Job alerts & battery — badiyos Expert" },
      { name: "description", content: "Allow full-screen job alerts, Do Not Disturb access and background running on Xiaomi, Vivo, Oppo, Realme and Samsung." },
      { property: "og:title", content: "Job alerts & battery — badiyos Expert" },
      { property: "og:description", content: "Make sure job alerts ring loudly on your phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BatteryGuide,
});

const OEMS = ["xiaomi", "vivo", "oppo", "realme", "samsung"] as const;
type Oem = (typeof OEMS)[number];

const OEM_BUTTONS: Record<Oem, { kind: OemSettingKind; label: TranslationKey }[]> = {
  xiaomi: [
    { kind: "xiaomi_autostart", label: "alerts.oem.xiaomiAutostart" },
    { kind: "xiaomi_popup", label: "alerts.oem.xiaomiPopup" },
  ],
  vivo: [{ kind: "vivo", label: "alerts.oem.popup" }],
  oppo: [{ kind: "oppo", label: "alerts.oem.popup" }],
  realme: [{ kind: "realme", label: "alerts.oem.popup" }],
  samsung: [{ kind: "samsung", label: "alerts.oem.samsung" }],
};

function detectOem(m: string): Oem | null {
  if (/xiaomi|redmi|poco/.test(m)) return "xiaomi";
  if (/vivo|iqoo/.test(m)) return "vivo";
  if (/realme/.test(m)) return "realme";
  if (/oppo|oneplus/.test(m)) return "oppo";
  if (/samsung/.test(m)) return "samsung";
  return null;
}

function BatteryGuide() {
  const t = useT();
  const [status, setStatus] = useState<AlertSetupStatus | null>(null);

  const refresh = useCallback(() => {
    void getAlertSetupStatus().then(setStatus);
  }, []);

  useEffect(() => {
    markAlertSetupPrompted();
    refresh();
    // Re-check when the expert comes back from a settings page.
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const native = status !== null && !status.unavailable;
  const myOem = status ? detectOem(status.manufacturer) : null;
  const oemOrder = myOem ? [myOem, ...OEMS.filter((o) => o !== myOem)] : [...OEMS];

  const open = async (p: Promise<boolean>) => {
    if (!(await p)) toast.error(t("battery.manual"));
  };

  const items: { key: string; label: TranslationKey; why: TranslationKey; ok: boolean; action: () => void; show: boolean }[] = status
    ? [
        { key: "notif", label: "alerts.item.notifications", why: "alerts.why.notifications", ok: status.notifications, action: () => void open(openAlertSetting("openNotificationSettings")), show: true },
        { key: "fsi", label: "alerts.item.fullScreen", why: "alerts.why.fullScreen", ok: status.fullScreen, action: () => void open(openAlertSetting("openFullScreenSettings")), show: status.fullScreenRequiresSetting },
        { key: "battery", label: "alerts.item.battery", why: "alerts.why.battery", ok: status.batteryUnrestricted, action: () => void open(openAlertSetting("openBatteryOptimisation")), show: true },
        { key: "dnd", label: "alerts.item.dnd", why: "alerts.why.dnd", ok: status.dndAccess, action: () => void open(openAlertSetting("openDndAccessSettings")), show: true },
      ]
    : [];

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pb-[max(env(safe-area-inset-bottom),1rem)]">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-background px-6 pb-4 pt-[calc(var(--safe-top)+1.5rem)]">
        <Link to="/profile" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted" aria-label="Back">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">{t("alerts.title")}</h1>
      </header>

      <section className="px-6">
        <p className="text-[14px] text-[color:var(--text-secondary)]">{t("alerts.intro")}</p>

        {native ? (
          <ul className="mt-4 space-y-2">
            {items.filter((i) => i.show).map((i) => (
              <li key={i.key} className="rounded-[14px] border border-border bg-card p-4 card-lift">
                <div className="flex items-start gap-3">
                  {i.ok ? (
                    <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-label={t("alerts.allowed")} />
                  ) : (
                    <Circle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" aria-label={t("alerts.notAllowed")} />
                  )}
                  <div className="flex-1">
                    <p className="text-[15px] font-bold text-foreground">{t(i.label)}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">{t(i.why)}</p>
                    {i.ok ? (
                      <p className="mt-2 text-[13px] font-semibold text-primary">{t("alerts.allowed")}</p>
                    ) : (
                      <button type="button" onClick={i.action} className="mt-3 h-11 w-full rounded-[12px] bg-primary text-[14px] font-bold text-primary-foreground">
                        {t("alerts.allow")}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-[14px] border border-border bg-card p-4 text-[13px] text-[color:var(--text-secondary)]">
            {status === null ? "…" : t("alerts.needsApp")}
          </p>
        )}
      </section>

      <section className="mt-6 px-6">
        <SectionHeading>{t("alerts.phoneSteps")}</SectionHeading>
        <ul className="mt-3 space-y-2">
          {oemOrder.map((oem) => (
            <li key={oem} className={`rounded-[14px] border bg-card p-4 card-lift ${oem === myOem ? "border-primary" : "border-border"}`}>
              <p className="flex items-center gap-2 text-[15px] font-bold text-foreground">
                <Zap className="h-4 w-4 text-primary" />
                {t(`battery.oem.${oem}` as TranslationKey)}
                {oem === myOem && <span className="ml-auto text-[12px] font-semibold text-primary">{t("alerts.yourPhone")}</span>}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
                {t(`battery.oem.${oem}.steps` as TranslationKey)}
              </p>
              {native && (
                <div className="mt-3 flex flex-col gap-2">
                  {OEM_BUTTONS[oem].map((b) => (
                    <button
                      key={b.kind}
                      type="button"
                      onClick={() => void open(openOemSetting(b.kind))}
                      className="h-11 w-full rounded-[12px] border border-border bg-background text-[13px] font-bold text-foreground"
                    >
                      {t(b.label)}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-[color:var(--text-secondary)]">{t("alerts.oemNote")}</p>
      </section>
    </div>
  );
}
