import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { leavePackets, printedPacketCode, type LeaveReason, type LeaveResult, type TripPacket } from "@/lib/courier";
import { hapticNotification } from "@/lib/haptics";
import { useT } from "@/lib/i18n";

const REASONS: { code: LeaveReason; key: "courier.leave.r.NOT_READY" | "courier.leave.r.BUSINESS_HOLD" | "courier.leave.r.DAMAGED" | "courier.leave.r.OTHER" }[] = [
  { code: "NOT_READY", key: "courier.leave.r.NOT_READY" },
  { code: "BUSINESS_HOLD", key: "courier.leave.r.BUSINESS_HOLD" },
  { code: "DAMAGED", key: "courier.leave.r.DAMAGED" },
  { code: "OTHER", key: "courier.leave.r.OTHER" },
];

type Props = {
  orderId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  packets: TripPacket[]; // all remaining packets of the trip
  onDone: (r: LeaveResult) => void;
};

export function LeavePacketsSheet({ orderId, open, onOpenChange, selectedIds, setSelectedIds, packets, onDone }: Props) {
  const t = useT();
  const [reason, setReason] = useState<LeaveReason | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason(null);
      setNotes("");
      setErr(null);
    }
  }, [open]);

  const selected = packets.filter((p) => selectedIds.includes(p.id));
  const unscanned = packets.filter((p) => !p.scanned_pickup_at);
  const leavesAll = unscanned.length > 0 && packets.every((p) => selectedIds.includes(p.id));
  const canSubmit = selected.length > 0 && !!reason && (reason !== "OTHER" || notes.trim().length > 0) && !busy;

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await leavePackets(orderId, selectedIds, reason, reason === "OTHER" ? notes.trim() : notes.trim() || null);
      if (r?.ok) {
        hapticNotification("success");
        onDone(r);
        return;
      }
      hapticNotification("error");
      if (r?.reason === "packet_scanned") setErr(t("courier.leave.err.scanned"));
      else if (r?.reason === "select_all_unsealed_packets_of_drop") {
        setErr(t("courier.leave.err.allUnsealed"));
        const drops = new Set(selected.filter((p) => !p.is_seal).map((p) => p.drop_stop_id));
        const extra = unscanned.filter((p) => !p.is_seal && drops.has(p.drop_stop_id)).map((p) => p.id);
        setSelectedIds(Array.from(new Set([...selectedIds, ...extra])));
      } else setErr(t("courier.leave.err.generic"));
    } catch (e) {
      hapticNotification("error");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-[20px]">
        <SheetHeader>
          <SheetTitle>{t("courier.leave.title")}</SheetTitle>
        </SheetHeader>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span key={p.id} className="rounded-full bg-muted px-2.5 py-1 text-[12px] font-semibold tracking-wider text-foreground">
              {printedPacketCode(p)}
              {p.drop_label ? ` · ${p.drop_label}` : ""}
            </span>
          ))}
        </div>
        <p className="mt-4 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">{t("courier.leave.reason")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => setReason(r.code)}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${
                reason === r.code ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground"
              }`}
            >
              {t(r.key)}
            </button>
          ))}
        </div>
        {reason === "OTHER" && (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("courier.leave.notes")}
            className="mt-3 h-20 w-full rounded-[14px] border border-border bg-background p-3 text-[14px] text-foreground outline-none focus:border-primary"
          />
        )}
        {leavesAll && (
          <p className="mt-3 flex items-center gap-2 rounded-[12px] bg-destructive/10 px-3 py-2 text-[13px] font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {t("courier.leave.cancelWarn")}
          </p>
        )}
        {err && <p className="mt-3 rounded-[12px] bg-destructive/10 px-3 py-2 text-[13px] font-semibold text-destructive">{err}</p>}
        <p className="mt-4 text-[13px] text-muted-foreground">{t("courier.leave.confirm", { n: selected.length })}</p>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`mt-3 flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-bold disabled:opacity-50 ${
            leavesAll ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
          }`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("courier.leave.submit", { n: selected.length })}
        </button>
      </SheetContent>
    </Sheet>
  );
}
