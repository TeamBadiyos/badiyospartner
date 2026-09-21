import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Clock, CalendarDays, Bike, Info } from "lucide-react";
import { useExpert, useExpertSession } from "@/lib/expert-client";
import { useCourierSkill } from "@/lib/courier";
import { useServiceSchedule, formatTime, type ServiceState } from "@/lib/service-hours";
import { useT, useLanguage } from "@/lib/i18n";

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "My working hours — badiyos Expert" },
      { name: "description", content: "Service opening times, off days and upcoming holidays." },
      { property: "og:title", content: "My working hours — badiyos Expert" },
      { property: "og:description", content: "Service opening times, off days and upcoming holidays." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScheduleScreen,
});

function StatusBadge({ state }: { state: ServiceState | null | undefined }) {
  const t = useT();
  if (!state) return null;
  const status = (state.status ?? "").toLowerCase();
  let label = state.open ? t("schedule.open") : t("schedule.closed");
  let tone = state.open ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground";
  if (status === "hidden" || status === "coming_soon") {
    label = t("schedule.status.comingSoon");
    tone = "bg-muted text-muted-foreground";
  } else if (status === "temporarily_stopped") {
    label = t("schedule.status.stopped");
    tone = "bg-[color:var(--color-destructive)]/10 text-[color:var(--color-destructive)]";
  }
  return (
    <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${tone}`}>{label}</span>
  );
}

function HoursCard({
  title,
  icon,
  serviceKey,
  enabled,
  showLastOrder,
}: {
  title: string;
  icon: React.ReactNode;
  serviceKey: "clean" | "courier";
  enabled: boolean;
  showLastOrder?: boolean;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const q = useServiceSchedule(serviceKey, enabled);
  const data = q.data;
  const today = new Date().getDay();

  if (!enabled) return null;

  return (
    <div className="rounded-[18px] border border-border bg-card p-4 card-lift">
      <div className="flex items-center gap-3">
        <div className="icon-tile flex h-10 w-10 items-center justify-center rounded-full">{icon}</div>
        <p className="flex-1 text-[15px] font-bold text-foreground">{title}</p>
        <StatusBadge state={data?.state} />
      </div>

      <p className="mt-4 text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
        {t("schedule.weekly")}
      </p>
      {(data?.hours?.length ?? 0) === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">{t("schedule.weeklyEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {data!.hours.map((h) => (
            <li
              key={h.weekday}
              className={`flex items-center justify-between rounded-[10px] px-2 py-1.5 text-[14px] ${
                h.weekday === today ? "bg-primary/5 font-bold text-foreground" : "text-foreground"
              }`}
            >
              <span>
                {t(`schedule.day.${h.weekday}` as "schedule.day.0")}
                {h.weekday === today ? ` · ${t("schedule.today")}` : ""}
              </span>
              <span className={h.is_closed ? "text-muted-foreground" : ""}>
                {h.is_closed
                  ? t("schedule.offDay")
                  : `${formatTime(h.open_time)} – ${formatTime(h.close_time)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {showLastOrder && data?.state?.last_order_at && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {t("schedule.courier.lastOrder").replace(
            "{time}",
            new Date(data.state.last_order_at).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
          )}
        </p>
      )}

      <p className="mt-4 text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
        {t("schedule.holidays")}
      </p>
      {(data?.holidays?.length ?? 0) === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">{t("schedule.holidaysEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {data!.holidays.map((h) => (
            <li key={h.id} className="flex items-start gap-2 text-[14px] text-foreground">
              <CalendarDays className="mt-0.5 h-4 w-4 text-primary" />
              <span>
                <span className="font-semibold">
                  {h.start_date}
                  {h.end_date && h.end_date !== h.start_date ? ` – ${h.end_date}` : ""}
                </span>
                {(lang === "mr" ? h.reason_mr || h.reason : h.reason) && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {lang === "mr" ? h.reason_mr || h.reason : h.reason}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScheduleScreen() {
  const t = useT();
  const { userId } = useExpertSession();
  const { data: expert } = useExpert(userId);
  const courierSkill = useCourierSkill(expert?.id);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pb-[max(env(safe-area-inset-bottom),1rem)]">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-background px-6 pb-4 pt-[calc(var(--safe-top)+1.5rem)]">
        <Link
          to="/profile"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">{t("schedule.title")}</h1>
      </header>

      <section className="space-y-4 px-6">
        <HoursCard
          title={t("profile.schedule")}
          icon={<Clock className="h-5 w-5 text-primary" />}
          serviceKey="clean"
          enabled={!!expert?.id}
        />
        <HoursCard
          title={t("schedule.courier")}
          icon={<Bike className="h-5 w-5 text-primary" />}
          serviceKey="courier"
          enabled={!!expert?.id && courierSkill.data === true}
          showLastOrder
        />
        <div className="flex items-start gap-2 rounded-[14px] border border-border bg-muted/40 p-3">
          <Info className="mt-0.5 h-4 w-4 text-[color:var(--text-secondary)]" />
          <p className="text-[13px] text-muted-foreground">{t("schedule.note")}</p>
        </div>
      </section>
    </div>
  );
}
