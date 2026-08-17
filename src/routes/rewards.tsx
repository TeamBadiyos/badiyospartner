import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Award, Star, Zap, Gift, Coins, TrendingUp, RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/lib/i18n";
import { SectionHeading } from "@/components/section-heading";
import { supabase } from "@/integrations/supabase/client";
import { useExpertSession, formatINR } from "@/lib/expert-client";

export const Route = createFileRoute("/rewards")({
  head: () => ({
    meta: [
      { title: "Rewards — badiyos Expert" },
      { name: "description", content: "Track your bonuses, rewards history and level progress on badiyos." },
      { property: "og:title", content: "Rewards — badiyos Expert" },
      { property: "og:description", content: "Track your bonuses, rewards history and level progress on badiyos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RewardsScreen,
});

type LedgerRow = {
  id: string;
  program_name: string | null;
  trigger_type: string | null;
  reward_type: string;
  reward_value: number;
  status: string;
  notes: string | null;
  credited_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
};

type ProgramRow = {
  id: string;
  name: string;
  trigger_type: string;
  trigger_label: string | null;
  reward_type: string;
  reward_value: number;
  is_time_based: boolean;
  period: string;
  target: number | null;
  progress: number | null;
  valid_until: string | null;
};

type Overview = { ledger: LedgerRow[]; total_earned: number; programs: ProgramRow[] };

function RewardsScreen() {
  const t = useT();
  const { userId } = useExpertSession();

  const { data, isError } = useQuery({
    queryKey: ["expert-rewards", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Overview> => {
      const { data, error } = await (
        supabase.rpc as unknown as (fn: string) => Promise<{ data: unknown; error: Error | null }>
      )("expert_rewards_overview");
      if (error) throw error;
      const d = (data ?? {}) as Partial<Overview>;
      return {
        ledger: d.ledger ?? [],
        total_earned: Number(d.total_earned ?? 0),
        programs: d.programs ?? [],
      };
    },
  });

  const level = t("rewards.level.bronze");
  const jobs = 12;
  const nextLevel = t("rewards.level.silver");
  const target = 25;
  const pct = Math.min(100, (jobs / target) * 100);

  const fmtValue = (type: string, value: number) =>
    type === "coins" ? `${Math.round(value)} ${t("rewards.reward.coins")}` : formatINR(value);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pb-[max(env(safe-area-inset-bottom),1rem)]">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-background px-6 pb-4 pt-[calc(var(--safe-top)+1.5rem)]">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">{t("rewards.title")}</h1>
      </header>

      <section className="px-6">
        <div className="rounded-[18px] border border-border bg-card p-6 card-lift">
          <div className="flex items-center gap-3">
            <div className="icon-tile-strong flex h-12 w-12 items-center justify-center rounded-full"><Award className="h-6 w-6 text-primary" /></div>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">{t("rewards.currentLevel")}</p>
              <p className="text-[22px] font-bold text-foreground">{level}</p>
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-[color:var(--text-secondary)]">
              <span>{t("rewards.progress", { jobs, target, level: nextLevel })}</span>
              <span className="text-primary">{Math.round(pct)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[color:var(--color-divider)]">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </section>

      {/* Total earned */}
      <section className="mt-4 px-6">
        <div className="rounded-[18px] border border-border bg-card p-5 card-lift">
          <div className="flex items-center gap-3">
            <div className="icon-tile flex h-10 w-10 items-center justify-center rounded-full"><Coins className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">{t("rewards.totalEarned")}</p>
              <p className="amount-strong text-[26px] text-foreground">{formatINR(data?.total_earned ?? 0)}</p>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-[color:var(--text-secondary)]">{t("rewards.totalNote")}</p>
        </div>
      </section>

      {/* Active bonuses */}
      <section className="mt-6 px-6">
        <SectionHeading>{t("rewards.active")}</SectionHeading>
        <ul className="mt-3 space-y-3">
          {(data?.programs ?? []).map((p) => {
            const hasProgress = p.target != null && p.progress != null;
            const ppct = hasProgress ? Math.min(100, (Number(p.progress) / Math.max(1, Number(p.target))) * 100) : 0;
            const unit = p.trigger_type === "hours_threshold" ? t("rewards.unit.hours") : t("rewards.unit.jobs");
            const period = p.period === "monthly" ? t("rewards.period.monthly") : t("rewards.period.weekly");
            return (
              <li key={p.id} className="rounded-[14px] border border-border bg-card p-4 card-lift">
                <div className="flex items-start gap-3">
                  <div className="icon-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-full"><TrendingUp className="h-5 w-5 text-primary" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[15px] font-bold text-foreground">{p.name}</p>
                      <p className="amount-strong shrink-0 text-[15px] text-primary">{fmtValue(p.reward_type, Number(p.reward_value))}</p>
                    </div>
                    {p.trigger_label ? (
                      <p className="text-[13px] text-[color:var(--text-secondary)]">{p.trigger_label}</p>
                    ) : null}
                    {hasProgress ? (
                      <div className="mt-3">
                        <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-[color:var(--text-secondary)]">
                          <span>
                            {t("rewards.active.progress", {
                              current: Number(p.progress).toFixed(p.trigger_type === "hours_threshold" ? 1 : 0),
                              target: String(p.target),
                              unit,
                              period,
                            })}
                          </span>
                          <span className="text-primary">{Math.round(ppct)}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[color:var(--color-divider)]">
                          <div className="h-2 rounded-full bg-primary" style={{ width: `${ppct}%` }} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
          {(data?.programs ?? []).length === 0 ? (
            <li className="rounded-[14px] border border-border bg-card p-4 text-[13px] text-[color:var(--text-secondary)] card-lift">
              {isError ? t("rewards.loadFailed") : t("rewards.active.empty")}
            </li>
          ) : null}
        </ul>
      </section>

      {/* Rewards history */}
      <section className="mt-6 px-6">
        <SectionHeading>{t("rewards.history")}</SectionHeading>
        <ul className="mt-3 space-y-3">
          {(data?.ledger ?? []).map((r) => {
            const reversed = r.status === "reversed";
            return (
              <li key={r.id} className="rounded-[14px] border border-border bg-card p-4 card-lift">
                <div className="flex items-start gap-3">
                  <div className="icon-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                    {reversed ? <RotateCcw className="h-5 w-5 text-primary" /> : <Gift className="h-5 w-5 text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[15px] font-bold text-foreground">{r.program_name ?? t("rewards.title")}</p>
                      <p className={`amount-strong shrink-0 text-[15px] ${reversed ? "text-[color:var(--text-secondary)] line-through" : "text-foreground"}`}>
                        {fmtValue(r.reward_type, Number(r.reward_value))}
                      </p>
                    </div>
                    <p className="text-[13px] text-[color:var(--text-secondary)]">
                      {[r.notes, fmtDate(r.credited_at)].filter(Boolean).join(" · ")}
                    </p>
                    {reversed ? (
                      <p className="mt-2 inline-flex rounded-full bg-[color:var(--color-divider)] px-2 py-0.5 text-[11px] font-bold tracking-[0.06em] text-[color:var(--text-secondary)]">
                        {t("rewards.status.reversed")}
                      </p>
                    ) : r.status !== "credited" ? (
                      <p className="mt-2 inline-flex rounded-full bg-[color:var(--color-divider)] px-2 py-0.5 text-[11px] font-bold tracking-[0.06em] text-[color:var(--text-secondary)]">
                        {t("rewards.status.pending")}
                      </p>
                    ) : null}
                    {reversed && r.reversal_reason ? (
                      <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">
                        {t("rewards.reversedNote", { reason: r.reversal_reason })}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
          {(data?.ledger ?? []).length === 0 ? (
            <li className="rounded-[14px] border border-border bg-card p-4 text-[13px] text-[color:var(--text-secondary)] card-lift">
              {isError ? t("rewards.loadFailed") : t("rewards.history.empty")}
            </li>
          ) : null}
        </ul>
      </section>

      <section className="mt-6 px-6">
        <SectionHeading>{t("rewards.perks")}</SectionHeading>
        <ul className="mt-3 space-y-3">
          {[
            { Icon: Star, title: t("rewards.perk.priority.title"), desc: t("rewards.perk.priority.desc") },
            { Icon: Zap, title: t("rewards.perk.payout.title"), desc: t("rewards.perk.payout.desc") },
            { Icon: Gift, title: t("rewards.perk.bonus.title"), desc: t("rewards.perk.bonus.desc") },
          ].map(({ Icon, title, desc }) => (
            <li key={title} className="flex items-start gap-3 rounded-[14px] border border-border bg-card p-4 card-lift">
              <div className="icon-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-full"><Icon className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-[15px] font-bold text-foreground">{title}</p>
                <p className="text-[13px] text-[color:var(--text-secondary)]">{desc}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="h-4" />
      </section>
    </div>
  );
}
