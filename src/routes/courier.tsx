import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Loader2, Package, MapPin, Clock, Bike } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, formatINR } from "@/lib/expert-client";
import { useCourierOffers, useCourierSkill, useActiveCourierOrder, type CourierOffer } from "@/lib/courier";
import { useT } from "@/lib/i18n";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { SectionHeading } from "@/components/section-heading";
import { hapticImpact, hapticNotification } from "@/lib/haptics";

export const Route = createFileRoute("/courier")({
  head: () => ({
    meta: [
      { title: "Courier deliveries — badiyos Expert" },
      { name: "description", content: "Accept bike delivery jobs near you." },
      { property: "og:title", content: "Courier deliveries — badiyos Expert" },
      { property: "og:description", content: "Accept bike delivery jobs near you." },
    ],
  }),
  component: CourierScreen,
});

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function CourierScreen() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { loading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);
  const skill = useCourierSkill(expert?.id);
  const online = !!expert?.is_online;
  const offersQ = useCourierOffers(!!expert?.id && skill.data === true);
  const activeQ = useActiveCourierOrder(expert?.id);

  // 1s tick so every card's countdown stays live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const respond = useMutation({
    mutationFn: async ({ offer, accept }: { offer: CourierOffer; accept: boolean }) => {
      const { data, error } = await supabase.rpc("courier_offer_respond", {
        _offer_id: offer.offer_id,
        _accept: accept,
      });
      if (error) throw error;
      return { res: data as { ok?: boolean; reason?: string; order_id?: string }, accept };
    },
    onSuccess: ({ res, accept }) => {
      void qc.invalidateQueries({ queryKey: ["courier-offers"] });
      if (!res?.ok) {
        const reason = res?.reason;
        if (reason === "already_taken") toast.info(t("courier.toast.taken"));
        else if (reason === "already_on_a_job") toast.error(t("courier.toast.busy"));
        else toast.info(t("courier.toast.expired"));
        return;
      }
      if (!accept) {
        toast.success(t("courier.toast.rejected"));
        return;
      }
      hapticNotification("success");
      toast.success(t("courier.toast.accepted"));
      void qc.invalidateQueries({ queryKey: ["courier-active", expert?.id] });
      if (res.order_id) navigate({ to: "/courier/$id", params: { id: res.order_id } });
    },
    onError: (err: Error) => toast.error(err.message || t("courier.toast.failed")),
  });

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const offers = (offersQ.data ?? []).filter((o) => secondsLeft(o.expires_at) > 0);
  const active = activeQ.data;

  return (
    <PullToRefresh className="relative" onRefresh={async () => { await offersQ.refetch(); await activeQ.refetch(); }}>
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pb-[max(env(safe-area-inset-bottom),1rem)]">
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-background px-6 pb-4 pt-[calc(var(--safe-top)+1.5rem)]">
          <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <h1 className="text-[22px] font-bold text-foreground">{t("courier.title")}</h1>
        </header>

        {active && (
          <section className="px-6 pb-4">
            <Link
              to="/courier/$id"
              params={{ id: active.id }}
              className="flex items-center gap-3 rounded-[18px] bg-primary p-4 text-primary-foreground shadow-[var(--shadow-brand-md)]"
            >
              <Bike className="h-6 w-6" />
              <div className="flex-1">
                <p className="text-[15px] font-bold">{t("courier.active.banner")}</p>
                <p className="text-[13px] opacity-85">{active.order_code ?? ""}</p>
              </div>
              <span className="text-[13px] font-bold underline">{t("courier.active.view")}</span>
            </Link>
          </section>
        )}

        <section className="px-6">
          <SectionHeading>{t("courier.offers.title")}</SectionHeading>
          {offers.length === 0 ? (
            <p className="mt-4 text-[13px] text-[color:var(--text-secondary)]">
              {online ? t("courier.offers.empty") : t("courier.offers.offline")}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {offers.map((o) => {
                const left = secondsLeft(o.expires_at);
                return (
                  <li key={o.offer_id} className="rounded-[18px] border border-border bg-card p-4 card-lift">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-destructive)]/10 px-3 py-1 text-[12px] font-bold text-[color:var(--color-destructive)]">
                        <Clock className="h-3.5 w-3.5" />
                        {t("courier.offer.expiresIn", { sec: left })}
                      </span>
                      <span className="amount-strong text-[18px] text-foreground">{formatINR(o.earning ?? 0)}</span>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-[color:var(--text-secondary)]">{t("courier.offer.pickup")}</p>
                          <p className="text-[14px] font-semibold text-foreground">{o.pickup_area ?? "—"}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 text-[color:var(--color-charcoal)]" />
                        <div>
                          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-[color:var(--text-secondary)]">{t("courier.offer.drop")}</p>
                          <p className="text-[14px] font-semibold text-foreground">{o.drop_area ?? "—"}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-[color:var(--text-secondary)]">
                      {o.parcel && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1">
                          <Package className="h-3.5 w-3.5" /> {o.parcel}
                        </span>
                      )}
                      {o.trip_km != null && (
                        <span className="rounded-full border border-border px-2.5 py-1">{t("courier.offer.trip", { km: o.trip_km })}</span>
                      )}
                      {o.distance_to_pickup_km != null && (
                        <span className="rounded-full border border-border px-2.5 py-1">{t("courier.offer.away", { km: o.distance_to_pickup_km })}</span>
                      )}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        disabled={respond.isPending}
                        onClick={() => { hapticImpact("light"); respond.mutate({ offer: o, accept: false }); }}
                        className="h-[52px] flex-1 rounded-[14px] border border-border bg-card font-bold text-foreground disabled:opacity-60"
                      >
                        {t("courier.reject")}
                      </button>
                      <button
                        type="button"
                        disabled={respond.isPending}
                        onClick={() => { hapticImpact("medium"); respond.mutate({ offer: o, accept: true }); }}
                        className="h-[52px] flex-[1.4] rounded-[14px] bg-primary font-bold text-primary-foreground disabled:opacity-60"
                      >
                        {respond.isPending ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : t("courier.accept")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </PullToRefresh>
  );
}
