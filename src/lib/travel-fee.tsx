import { formatINR } from "@/lib/expert-client";
import { useT } from "@/lib/i18n";

export type TravelFields = {
  travel_fee?: number | string | null;
  travel_expert_share_pct?: number | string | null;
};

/** Expert's share of the outer-zone travel fee (server-set on the booking). */
export function travelEarning(b: TravelFields | null | undefined): number {
  const fee = Number(b?.travel_fee ?? 0);
  if (!Number.isFinite(fee) || fee <= 0) return 0;
  const pct = b?.travel_expert_share_pct == null ? 100 : Number(b.travel_expert_share_pct);
  return Math.round(fee * (Number.isFinite(pct) ? pct : 100)) / 100;
}

/** Green "+₹20 Travel" pill — renders nothing when there is no travel fee. */
export function TravelBadge({ booking, className = "" }: { booking: TravelFields | null | undefined; className?: string }) {
  const t = useT();
  const amt = travelEarning(booking);
  if (amt <= 0) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border border-[color:var(--success-border)] bg-[color:var(--success-soft)] px-3 py-1 text-[12px] font-extrabold text-[color:var(--success-strong)] ${className}`}
    >
      +{formatINR(amt)} {t("travel.badge")}
    </span>
  );
}
