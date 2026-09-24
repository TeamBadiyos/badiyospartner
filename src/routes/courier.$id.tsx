import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Package,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  X,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, formatINR } from "@/lib/expert-client";
import {
  useCourierOrder,
  useCourierRoute,
  useCourierStoreInfo,
  useCourierLocationPing,
  riderEarning,
  mapsUrl,
  COURIER_ACTIVE_STATUSES,
  type CourierStop,
} from "@/lib/courier";
import { computeReturnDistances, getCourierFailWaitMinutes } from "@/lib/courier-returns.functions";
import { useT, type TranslationKey } from "@/lib/i18n";
import { hapticImpact, hapticNotification } from "@/lib/haptics";

export const Route = createFileRoute("/courier/$id")({
  head: () => ({
    meta: [
      { title: "Active delivery — badiyos Expert" },
      { name: "description", content: "Stop-by-stop pickup, OTP and drop steps for your active courier delivery." },
      { property: "og:title", content: "Active delivery — badiyos Expert" },
      { property: "og:description", content: "Stop-by-stop pickup, OTP and drop steps for your active courier delivery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CourierJob,
});

type RpcResult = { ok?: boolean; reason?: string; attempts_left?: number; amount?: number };

const PICKUP_REASONS = ["sender_unavailable", "parcel_not_ready", "prohibited_item", "other"] as const;
const DROP_REASONS = ["receiver_unavailable", "receiver_refused", "wrong_address", "not_reachable", "other"] as const;
const INCIDENTS = [
  { code: "damaged", label: "courier.incident.damaged_parcel" },
  { code: "accident", label: "courier.incident.accident_emergency" },
] as const;

function getFixDetailed(): Promise<{ lat: number; lng: number; accuracy: number; at: string }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation not supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          at: new Date(p.timestamp).toISOString(),
        }),
      reject,
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
  });
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function CourierJob() {
  const { id } = Route.useParams();
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { loading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);
  const orderQ = useCourierOrder(id);
  const order = orderQ.data;

  const active = !!order && (COURIER_ACTIVE_STATUSES as readonly string[]).includes(order.status);
  useCourierLocationPing(active);
  const isStore = !!order?.store_order_id || order?.source === "store";
  const storeQ = useCourierStoreInfo(id, isStore);

  const [fastPoll, setFastPoll] = useState(false);
  const routeQ = useCourierRoute(id, fastPoll);
  const stops = routeQ.data?.stops ?? [];
  const parcels = routeQ.data?.parcels ?? [];
  const charges = routeQ.data?.charges ?? [];

  const failWaitFn = useServerFn(getCourierFailWaitMinutes);
  const failWaitQ = useQuery({ queryKey: ["courier-fail-wait"], staleTime: 10 * 60_000, queryFn: () => failWaitFn() });
  const failWaitMin = failWaitQ.data ?? 10;
  const returnFn = useServerFn(computeReturnDistances);

  const [otp, setOtp] = useState("");
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [failCode, setFailCode] = useState<string | null>(null);
  const [failNotes, setFailNotes] = useState("");
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentCode, setIncidentCode] = useState<string | null>(null);
  const [incidentNotes, setIncidentNotes] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const current = useMemo(
    () => stops.find((s) => s.status === "pending" || s.status === "arrived") ?? null,
    [stops],
  );
  const pickupsIndex = useMemo(() => stops.filter((s) => s.stop_type === "pickup").map((s) => s.id), [stops]);
  const dropsIndex = useMemo(() => stops.filter((s) => s.stop_type === "drop").map((s) => s.id), [stops]);

  const pendingReturnAmount = useMemo(() => {
    if (!current || current.stop_type !== "return") return 0;
    const ids = new Set(parcels.filter((p) => p.return_stop_id === current.id).map((p) => p.id));
    return charges
      .filter((c) => c.status === "pending" && c.parcel_id && ids.has(c.parcel_id))
      .reduce((s, c) => s + Number(c.total_amount ?? 0), 0);
  }, [current, parcels, charges]);
  const paymentPending = pendingReturnAmount > 0;

  useEffect(() => {
    setFastPoll(paymentPending);
  }, [paymentPending]);

  // Reset the input when the current stop changes.
  useEffect(() => {
    setOtp("");
    setProofPath(null);
  }, [current?.id]);

  const now = useNow(!!current && current.status === "arrived");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["courier-order", id] });
    void qc.invalidateQueries({ queryKey: ["courier-route", id] });
    void qc.invalidateQueries({ queryKey: ["courier-active", expert?.id] });
    void qc.invalidateQueries({ queryKey: ["expert", userId] });
  };

  const arrive = useMutation({
    mutationFn: async (stop: CourierStop) => {
      const fix = await getFixDetailed();
      const { error } = await supabase.rpc("courier_rider_arrive_stop" as never, {
        _stop_id: stop.id,
        _lat: fix.lat,
        _lng: fix.lng,
        _accuracy_m: fix.accuracy,
        _fix_at: fix.at,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      hapticNotification("success");
      refresh();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      refresh();
    },
  });

  const verify = useMutation({
    mutationFn: async (stop: CourierStop) => {
      const { data, error } = await supabase.rpc("courier_verify_stop_otp" as never, {
        _stop_id: stop.id,
        _otp: otp,
        _proof_url: stop.stop_type === "drop" ? proofPath : null,
      } as never);
      if (error) throw error;
      return data as unknown as RpcResult;
    },
    onSuccess: (res) => {
      if (!res?.ok) {
        if (res?.reason === "locked") toast.error(t("courier.stop.otpLocked"));
        else if (res?.reason === "expired") toast.error(t("courier.stop.otpExpired"));
        else if (res?.reason === "payment_pending")
          toast.error(t("courier.stop.payWait", { amount: formatINR(Number(res.amount ?? 0)) }));
        else toast.error(t("courier.stop.otpWrong", { left: res?.attempts_left ?? 0 }));
        refresh();
        return;
      }
      setOtp("");
      hapticNotification("success");
      refresh();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      refresh();
    },
  });

  const failStop = useMutation({
    mutationFn: async (stop: CourierStop) => {
      if (!failCode) throw new Error(t("courier.stop.failTitle"));
      let distances: Record<string, number> | null = null;
      if (stop.stop_type === "drop") {
        distances = await returnFn({ data: { order_id: id, failing_stop_id: stop.id } });
      }
      const { error } = await supabase.rpc("courier_rider_fail_stop" as never, {
        _stop_id: stop.id,
        _reason_code: failCode,
        _notes: failNotes.trim() || null,
        _return_distances: distances,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("courier.stop.failDone"));
      setFailOpen(false);
      setFailCode(null);
      setFailNotes("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const report = useMutation({
    mutationFn: async () => {
      if (!incidentCode) throw new Error("Select a reason");
      const { error } = await supabase.rpc("courier_report_incident", {
        _order_id: id,
        _code: incidentCode,
        _notes: incidentNotes.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("courier.job.incidentDone"));
      setIncidentOpen(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("courier_rider_cancel", { _order_id: id, _reason: "rider_cancelled" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("courier.job.cancelDone"));
      refresh();
      navigate({ to: "/home" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onPickPhoto = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("courier-proofs")
        .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (error) throw error;
      setProofPath(path);
      toast.success(t("courier.job.photoAdded"));
    } catch (err) {
      console.warn("[courier] proof upload failed", err);
      toast.error(t("courier.job.photoFailed"));
    } finally {
      setUploading(false);
    }
  };

  if (loading || orderQ.isLoading || routeQ.isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center bg-background px-6 text-center">
        <p className="text-[15px] text-foreground">{t("courier.job.notFound")}</p>
        <Link to="/home" className="mt-6 flex h-[52px] w-full max-w-xs items-center justify-center rounded-[14px] bg-primary font-bold text-primary-foreground">
          {t("courier.job.backHome")}
        </Link>
      </div>
    );
  }

  const earning = formatINR(riderEarning(order));

  if (!active) {
    const returnPaid = charges
      .filter((c) => c.status === "paid" && (c.charge_type ?? "").includes("return"))
      .reduce((s, c) => s + Number(c.amount ?? c.total_amount ?? 0), 0);
    const allFailed = order.cancel_reason_code === "ALL_PICKUPS_FAILED";
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center bg-background px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="h-10 w-10 text-primary" />
        </div>
        <h1 className="mt-5 text-[22px] font-bold text-foreground">{t("courier.job.doneTitle")}</h1>
        {allFailed ? (
          <p className="mt-2 text-[14px] text-[color:var(--text-secondary)]">{t("courier.done.allPickupsFailed")}</p>
        ) : (
          <p className="mt-2 text-[14px] text-[color:var(--text-secondary)]">{t("courier.job.doneSub", { amount: earning })}</p>
        )}
        {returnPaid > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-[14px] font-semibold text-primary">
            <Wallet className="h-4 w-4" />
            {t("courier.done.returnEarning", { amount: formatINR(returnPaid) })}
          </p>
        )}
        <Link to="/home" className="mt-8 flex h-[54px] w-full items-center justify-center rounded-[16px] bg-primary text-[16px] font-bold text-primary-foreground">
          {t("courier.job.backHome")}
        </Link>
      </div>
    );
  }

  const total = stops.length || 1;
  const doneCount = stops.filter((s) => ["completed", "failed", "cancelled"].includes(s.status)).length;
  const stopNo = current ? stops.indexOf(current) + 1 : total;
  const anyPickupDone = stops.some((s) => s.stop_type === "pickup" && s.status === "completed");

  const typeLabel = (s: CourierStop) =>
    s.stop_type === "pickup"
      ? `${t("courier.stop.pickup")}${pickupsIndex.length > 1 ? ` ${pickupsIndex.indexOf(s.id) + 1}` : ""}`
      : s.stop_type === "drop"
        ? `${t("courier.stop.drop")}${dropsIndex.length > 1 ? ` ${dropsIndex.indexOf(s.id) + 1}` : ""}`
        : t("courier.stop.return");

  const parcelLines = (s: CourierStop): string[] => {
    if (s.stop_type === "pickup") {
      const mine = parcels.filter((p) => p.pickup_stop_id === s.id);
      const lines = [t("courier.stop.collect", { n: mine.length || 1 })];
      if (dropsIndex.length > 1)
        mine.forEach((p) => {
          if (p.drop_stop_id) lines.push(t("courier.stop.forDrop", { m: dropsIndex.indexOf(p.drop_stop_id) + 1 }));
        });
      return lines;
    }
    if (s.stop_type === "drop") {
      const mine = parcels.filter((p) => p.drop_stop_id === s.id);
      const lines = [t("courier.stop.deliver", { n: mine.length || 1 })];
      if (pickupsIndex.length > 1) {
        const from = Array.from(new Set(mine.map((p) => p.pickup_stop_id).filter(Boolean))) as string[];
        from.forEach((pid) => lines.push(t("courier.stop.fromPickup", { m: pickupsIndex.indexOf(pid) + 1 })));
      }
      return lines;
    }
    const mine = parcels.filter((p) => p.return_stop_id === s.id);
    return [t("courier.stop.returnN", { n: mine.length || 1 })];
  };

  const arrived = current?.status === "arrived";
  const failAt =
    current?.arrived_at ? new Date(current.arrived_at).getTime() + failWaitMin * 60_000 : Number.POSITIVE_INFINITY;
  const failLeftMs = Math.max(0, failAt - now);
  const failReady = arrived && failLeftMs === 0;
  const mmss = `${String(Math.floor(failLeftMs / 60000)).padStart(2, "0")}:${String(Math.floor((failLeftMs % 60000) / 1000)).padStart(2, "0")}`;
  const reasons = current?.stop_type === "pickup" ? PICKUP_REASONS : DROP_REASONS;
  const firstPickupId = pickupsIndex[0];

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-30 bg-background px-5 pb-3 pt-[calc(var(--safe-top)+1rem)]">
        <div className="flex items-center gap-2">
          <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <div className="flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
              #{order.order_code ?? ""}
            </p>
            <h1 className="text-[19px] font-bold leading-tight text-foreground">
              {t("courier.stop.progress", { x: stopNo, n: total })}
            </h1>
          </div>
          <div className="rounded-full bg-primary/10 px-3 py-1.5">
            <p className="amount-strong text-[15px] text-primary">{earning}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / total) * 100}%` }} />
        </div>

        {isStore && (
          <div className="mt-3 rounded-[12px] bg-muted/60 px-3 py-2">
            <p className="flex items-center gap-2 text-[12px] font-bold text-foreground">
              <Package className="h-4 w-4 text-primary" />
              {t("courier.store.label")}
              {storeQ.data?.store_name ? ` · ${storeQ.data.store_name}` : ""}
            </p>
            <p className="mt-0.5 pl-6 text-[12px] font-semibold text-[color:var(--text-secondary)]">
              {t("courier.store.order", { no: storeQ.data?.order_number ?? order.order_code ?? "" })}
              {storeQ.data?.item_count != null ? ` · ${t("courier.store.items", { n: String(storeQ.data.item_count) })}` : ""}
            </p>
          </div>
        )}
      </header>

      <main className="flex-1 space-y-3 px-5 pb-40 pt-1">
        {current && (
          <div className="rounded-[18px] border border-primary/40 bg-card p-4 card-lift">
            <div className="flex items-center justify-between">
              <span
                className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
                  current.stop_type === "return" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                }`}
              >
                {typeLabel(current)}
              </span>
              <span className="text-[11px] font-bold uppercase text-[color:var(--text-secondary)]">
                {t(`courier.stop.status.${current.status}` as TranslationKey)}
              </span>
            </div>
            <div className="mt-3 flex items-start gap-2">
              <MapPin className="mt-0.5 h-5 w-5 text-primary" />
              <p className="flex-1 text-[16px] font-semibold leading-snug text-foreground">{current.address ?? "—"}</p>
            </div>
            <div className="mt-2 space-y-0.5 pl-7">
              {parcelLines(current).map((l, i) => (
                <p key={i} className={`text-[13px] ${i === 0 ? "font-bold text-foreground" : "text-[color:var(--text-secondary)]"}`}>
                  {l}
                </p>
              ))}
            </div>
            {isStore && current.stop_type === "pickup" && current.id === firstPickupId && (
              <p className="mt-2 pl-7 text-[12px] font-semibold text-primary">{t("courier.store.pickupOtpHint")}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {current.contact_phone ? (
                <a
                  href={`tel:${current.contact_phone}`}
                  className="flex h-12 items-center justify-center gap-2 truncate rounded-[14px] border border-border px-2 text-[13px] font-bold text-foreground"
                >
                  <Phone className="h-4 w-4 text-primary" />
                  <span className="truncate">{current.contact_name || t("courier.job.call")}</span>
                </a>
              ) : (
                <div />
              )}
              <a
                href={mapsUrl(current.lat, current.lng, current.address)}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 items-center justify-center gap-2 rounded-[14px] bg-primary/10 text-[14px] font-bold text-primary"
              >
                <Navigation className="h-4 w-4" />
                {t("courier.job.navigate")}
              </a>
            </div>
          </div>
        )}

        {current && arrived && current.stop_type === "return" && paymentPending && (
          <div className="rounded-[18px] border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-[14px] font-bold text-foreground">
              {t("courier.stop.payWait", { amount: formatINR(pendingReturnAmount) })}
            </p>
            {order.needs_ops_attention && (
              <p className="mt-1 text-[12px] font-semibold text-[color:var(--text-secondary)]">{t("courier.stop.opsInformed")}</p>
            )}
            {order.pickup_contact_phone && (
              <a
                href={`tel:${order.pickup_contact_phone}`}
                className="mt-3 flex h-11 items-center justify-center gap-2 rounded-[14px] border border-border bg-background text-[13px] font-bold text-foreground"
              >
                <Phone className="h-4 w-4 text-primary" />
                {t("courier.stop.callCustomer")}
              </a>
            )}
          </div>
        )}

        {current && arrived && !(current.stop_type === "return" && paymentPending) && (
          <>
            <OtpBlock label={t("courier.stop.otpHelp")} value={otp} onChange={setOtp} />
            {current.stop_type === "drop" && (
              <div className="rounded-[18px] border border-border bg-card p-4">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    void onPickPhoto(e.target.files?.[0] ?? null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-background text-[14px] font-bold text-foreground disabled:opacity-60"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4 text-primary" />}
                  {proofPath ? t("courier.job.photoAdded") : t("courier.job.photo")}
                </button>
              </div>
            )}
          </>
        )}

        {current && arrived && current.stop_type !== "return" && (
          <button
            type="button"
            disabled={!failReady}
            onClick={() => setFailOpen(true)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-border text-[13px] font-bold text-foreground disabled:opacity-50"
          >
            {failReady ? t("courier.stop.fail") : `${t("courier.stop.fail")} · ${t("courier.stop.failIn", { t: mmss })}`}
          </button>
        )}

        {stops.length > 1 && (
          <div className="rounded-[18px] border border-border bg-card">
            <button
              type="button"
              onClick={() => setShowUpcoming((v) => !v)}
              className="flex h-12 w-full items-center justify-between px-4 text-[13px] font-bold text-foreground"
            >
              {t("courier.stop.upcoming")}
              <ChevronDown className={`h-4 w-4 transition ${showUpcoming ? "rotate-180" : ""}`} />
            </button>
            {showUpcoming && (
              <ul className="space-y-1 px-4 pb-3">
                {stops.map((s) => {
                  const done = ["completed", "failed", "cancelled"].includes(s.status);
                  return (
                    <li key={s.id} className={`flex items-center gap-2 py-1.5 ${done ? "opacity-50" : ""}`}>
                      <span className="w-16 shrink-0 text-[11px] font-bold uppercase text-primary">{typeLabel(s)}</span>
                      <span className="flex-1 truncate text-[12px] text-foreground">{s.address ?? "—"}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-[color:var(--text-secondary)]">
                        {t(`courier.stop.status.${s.status}` as TranslationKey)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setIncidentOpen(true)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] text-[13px] font-bold text-[color:var(--color-destructive)]"
        >
          <AlertTriangle className="h-4 w-4" />
          {t("courier.job.reportIssue")}
        </button>

        {!anyPickupDone ? (
          <div className="text-center">
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() => {
                if (window.confirm(t("courier.job.cancelConfirm"))) cancel.mutate();
              }}
              className="h-10 w-full rounded-[14px] text-[13px] font-semibold text-[color:var(--text-secondary)] disabled:opacity-60"
            >
              {t("courier.stop.cantDo")}
            </button>
            <p className="text-[11px] text-[color:var(--text-secondary)]">{t("courier.stop.cantDoHelp")}</p>
          </div>
        ) : (
          <Link
            to="/sos"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-destructive/40 text-[13px] font-semibold text-destructive"
          >
            <AlertTriangle className="h-4 w-4" />
            {t("courier.store.emergency")}
          </Link>
        )}
      </main>

      {current && (
        <div className="sticky bottom-0 z-30 border-t border-border bg-background/95 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 backdrop-blur">
          {!arrived ? (
            <PrimaryAction
              busy={arrive.isPending}
              label={t("courier.stop.arrive")}
              onClick={() => {
                hapticImpact("medium");
                arrive.mutate(current);
              }}
            />
          ) : (
            <PrimaryAction
              busy={verify.isPending}
              disabled={otp.length < 4 || (current.stop_type === "return" && paymentPending)}
              label={t("courier.stop.verify")}
              onClick={() => verify.mutate(current)}
            />
          )}
        </div>
      )}

      {failOpen && current && (
        <Sheet title={t("courier.stop.failTitle")} onClose={() => setFailOpen(false)}>
          <ul className="mt-3 space-y-2">
            {reasons.map((code) => (
              <li key={code}>
                <button
                  type="button"
                  onClick={() => setFailCode(code)}
                  className={`flex h-11 w-full items-center rounded-[12px] border px-3 text-left text-[14px] font-semibold ${
                    failCode === code ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground"
                  }`}
                >
                  {t(`courier.fail.${code}` as TranslationKey)}
                </button>
              </li>
            ))}
          </ul>
          <textarea
            value={failNotes}
            onChange={(e) => setFailNotes(e.target.value)}
            placeholder={t("courier.stop.failNotes")}
            rows={3}
            className="mt-3 w-full rounded-[12px] border border-border bg-background p-3 text-[14px] text-foreground"
          />
          <button
            type="button"
            disabled={!failCode || (failCode === "other" && !failNotes.trim()) || failStop.isPending}
            onClick={() => {
              if (current.stop_type === "pickup" && !window.confirm(t("courier.stop.failPickupConfirm"))) return;
              failStop.mutate(current);
            }}
            className="mt-3 flex h-[52px] w-full items-center justify-center rounded-[14px] bg-[color:var(--color-destructive)] font-bold text-destructive-foreground disabled:opacity-60"
          >
            {failStop.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : t("courier.stop.failSubmit")}
          </button>
        </Sheet>
      )}

      {incidentOpen && (
        <Sheet title={t("courier.job.incidentTitle")} onClose={() => setIncidentOpen(false)}>
          <ul className="mt-3 space-y-2">
            {INCIDENTS.map((i) => (
              <li key={i.code}>
                <button
                  type="button"
                  onClick={() => setIncidentCode(i.code)}
                  className={`flex h-11 w-full items-center rounded-[12px] border px-3 text-left text-[14px] font-semibold ${
                    incidentCode === i.code ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground"
                  }`}
                >
                  {t(i.label)}
                </button>
              </li>
            ))}
          </ul>
          <textarea
            value={incidentNotes}
            onChange={(e) => setIncidentNotes(e.target.value)}
            placeholder={t("courier.job.incidentNotes")}
            rows={3}
            className="mt-3 w-full rounded-[12px] border border-border bg-background p-3 text-[14px] text-foreground"
          />
          <button
            type="button"
            disabled={!incidentCode || report.isPending}
            onClick={() => report.mutate()}
            className="mt-3 flex h-[52px] w-full items-center justify-center rounded-[14px] bg-[color:var(--color-destructive)] font-bold text-destructive-foreground disabled:opacity-60"
          >
            {report.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : t("courier.job.submitIncident")}
          </button>
          <Link to="/sos" className="mt-2 flex h-11 items-center justify-center text-[13px] font-semibold text-destructive">
            SOS
          </Link>
        </Sheet>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-foreground/50" onClick={onClose}>
      <div
        className="w-full rounded-t-[22px] bg-card p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[16px] font-bold text-foreground">{title}</p>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-[color:var(--text-secondary)]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PrimaryAction({
  label,
  onClick,
  busy,
  disabled,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className="flex h-[56px] w-full items-center justify-center rounded-[16px] bg-primary text-[16px] font-bold text-primary-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : label}
    </button>
  );
}

function OtpBlock({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="rounded-[18px] border border-border bg-card p-4">
      <p className="text-[13px] font-semibold text-foreground">{label}</p>
      <div className="relative mt-3">
        <div className="pointer-events-none flex justify-between gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`flex h-14 flex-1 items-center justify-center rounded-[14px] border text-[24px] font-bold text-foreground ${
                value.length === i ? "border-primary bg-primary/5" : "border-border bg-background"
              }`}
            >
              {value[i] ?? ""}
            </div>
          ))}
        </div>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className="absolute inset-0 h-full w-full opacity-0"
        />
      </div>
    </div>
  );
}
