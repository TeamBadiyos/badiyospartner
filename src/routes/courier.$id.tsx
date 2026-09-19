import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Loader2, MapPin, Navigation, Phone, Package, AlertTriangle, Camera, CheckCircle2 } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, formatINR } from "@/lib/expert-client";
import {
  useCourierOrder,
  useCourierLocationPing,
  riderEarning,
  mapsUrl,
  getFix,
  INCIDENT_CODES,
  COURIER_ACTIVE_STATUSES,
  type IncidentCode,
  type CourierOrder,
} from "@/lib/courier";
import { useT, type TranslationKey } from "@/lib/i18n";
import { hapticImpact, hapticNotification } from "@/lib/haptics";

export const Route = createFileRoute("/courier/$id")({
  head: () => ({
    meta: [
      { title: "Active delivery — badiyos Expert" },
      { name: "description", content: "Pickup, OTP and drop steps for your active courier delivery." },
      { property: "og:title", content: "Active delivery — badiyos Expert" },
      { property: "og:description", content: "Pickup, OTP and drop steps for your active courier delivery." },
    ],
  }),
  component: CourierJob,
});

type RpcResult = { ok?: boolean; reason?: string; attempts_left?: number };

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

  const [otp, setOtp] = useState("");
  const [showIncident, setShowIncident] = useState(false);
  const [incidentCode, setIncidentCode] = useState<IncidentCode | null>(null);
  const [notes, setNotes] = useState("");
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["courier-order", id] });
    void qc.invalidateQueries({ queryKey: ["courier-active", expert?.id] });
    void qc.invalidateQueries({ queryKey: ["expert", userId] });
  };

  const arrive = useMutation({
    mutationFn: async () => {
      const fix = await getFix();
      const { data, error } = await supabase.rpc("courier_rider_advance", {
        _order_id: id,
        _to_status: "ARRIVED_PICKUP",
        _lat: fix.lat,
        _lng: fix.lng,
      });
      if (error) throw error;
      return data as RpcResult;
    },
    onSuccess: (res) => {
      if (!res?.ok) {
        toast.error(t("courier.job.tooFar"));
        return;
      }
      hapticNotification("success");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startTransit = useMutation({
    mutationFn: async () => {
      const fix = await getFix().catch(() => null);
      const { data, error } = await supabase.rpc("courier_rider_advance", {
        _order_id: id,
        _to_status: "IN_TRANSIT",
        _lat: fix?.lat ?? undefined,
        _lng: fix?.lng ?? undefined,
      });
      if (error) throw error;
      return data as RpcResult;
    },
    onSuccess: () => { hapticNotification("success"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const verify = useMutation({
    mutationFn: async (purpose: "pickup" | "delivery") => {
      const { data, error } = await supabase.rpc("courier_verify_otp", {
        _order_id: id,
        _purpose: purpose,
        _otp: otp,
        _proof_url: purpose === "delivery" ? (proofPath ?? undefined) : undefined,
      });
      if (error) throw error;
      return { res: data as RpcResult, purpose };
    },
    onSuccess: ({ res, purpose }) => {
      if (!res?.ok) {
        if (res?.reason === "locked") toast.error(t("courier.job.otpLocked"));
        else if (res?.reason === "expired") toast.error(t("courier.job.otpExpired"));
        else toast.error(t("courier.job.otpWrong", { left: res?.attempts_left ?? 0 }));
        return;
      }
      setOtp("");
      hapticNotification("success");
      toast.success(purpose === "pickup" ? t("courier.job.pickedUp") : t("courier.job.delivered"));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const report = useMutation({
    mutationFn: async () => {
      if (!incidentCode) throw new Error("Select a reason");
      const detail = [notes.trim(), proofPath ? `proof:${proofPath}` : null].filter(Boolean).join(" | ");
      const { data, error } = await supabase.rpc("courier_report_incident", {
        _order_id: id,
        _code: incidentCode,
        _notes: detail || "",
      });
      if (error) throw error;
      return data as RpcResult;
    },
    onSuccess: () => {
      toast.success(t("courier.job.incidentDone"));
      setShowIncident(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("courier_rider_cancel", {
        _order_id: id,
        _reason: "rider_cancelled",
      });
      if (error) throw error;
      return data as RpcResult;
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
      const { error } = await supabase.storage.from("courier-proofs").upload(path, file, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });
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

  if (loading || orderQ.isLoading) {
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
        <Link to="/courier" className="mt-6 flex h-[52px] w-full max-w-xs items-center justify-center rounded-[14px] bg-primary font-bold text-primary-foreground">
          {t("courier.title")}
        </Link>
      </div>
    );
  }

  const st = order.status;
  const canCancel = st === "DRIVER_ASSIGNED";
  const showContact = st === "DRIVER_ASSIGNED" || st === "ARRIVED_PICKUP" ? "pickup" : st === "PICKED_UP" || st === "IN_TRANSIT" ? "drop" : null;
  const finished = !(COURIER_ACTIVE_STATUSES as readonly string[]).includes(st);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pb-[max(env(safe-area-inset-bottom),1rem)]">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-background px-6 pb-4 pt-[calc(var(--safe-top)+1.5rem)]">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <div>
          <h1 className="text-[22px] font-bold text-foreground">{t("courier.job.title")}</h1>
          <p className="text-[12px] text-[color:var(--text-secondary)]">{order.order_code ?? ""}</p>
        </div>
      </header>

      <section className="px-6">
        <div className="rounded-[18px] border border-border bg-card p-4 card-lift">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-[12px] font-bold text-primary">
              <Package className="h-3.5 w-3.5" />
              {order.package_description || t("courier.job.parcel")}
            </span>
            <div className="text-right">
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[color:var(--text-secondary)]">{t("courier.job.earning")}</p>
              <p className="amount-strong text-[18px] text-foreground">{formatINR(riderEarning(order))}</p>
            </div>
          </div>
          {order.weight_kg != null && (
            <p className="mt-2 text-[12px] text-[color:var(--text-secondary)]">{t("courier.job.weight", { kg: order.weight_kg })}</p>
          )}
        </div>
      </section>

      <section className="mt-4 space-y-3 px-6">
        <AddressCard
          title={t("courier.job.pickupTitle")}
          address={order.pickup_address}
          lat={order.pickup_lat}
          lng={order.pickup_lng}
          navigateLabel={t("courier.job.navigate")}
          highlight={st === "DRIVER_ASSIGNED" || st === "ARRIVED_PICKUP"}
        />
        <AddressCard
          title={t("courier.job.dropTitle")}
          address={order.drop_address}
          lat={order.drop_lat}
          lng={order.drop_lng}
          navigateLabel={t("courier.job.navigate")}
          highlight={st === "PICKED_UP" || st === "IN_TRANSIT"}
        />
      </section>

      {showContact && (
        <ContactCard
          order={order}
          which={showContact}
          callLabel={t("courier.job.call")}
        />
      )}

      <section className="mt-5 flex-1 px-6">
        {finished ? (
          <div className="rounded-[18px] border border-border bg-card p-5 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-2 text-[15px] font-bold text-foreground">{t("courier.job.finished")}</p>
            <Link to="/home" className="mt-4 flex h-[52px] items-center justify-center rounded-[14px] bg-primary font-bold text-primary-foreground">
              {t("courier.job.backHome")}
            </Link>
          </div>
        ) : st === "DRIVER_ASSIGNED" ? (
          <button
            type="button"
            disabled={arrive.isPending}
            onClick={() => { hapticImpact("medium"); arrive.mutate(); }}
            className="flex h-[56px] w-full items-center justify-center rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground disabled:opacity-60"
          >
            {arrive.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : t("courier.job.arrived")}
          </button>
        ) : st === "ARRIVED_PICKUP" ? (
          <OtpBlock
            label={t("courier.job.pickupOtp")}
            value={otp}
            onChange={setOtp}
            busy={verify.isPending}
            cta={t("courier.job.verify")}
            onSubmit={() => verify.mutate("pickup")}
          />
        ) : st === "PICKED_UP" ? (
          <button
            type="button"
            disabled={startTransit.isPending}
            onClick={() => { hapticImpact("medium"); startTransit.mutate(); }}
            className="flex h-[56px] w-full items-center justify-center rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground disabled:opacity-60"
          >
            {startTransit.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : t("courier.job.startTransit")}
          </button>
        ) : (
          <div className="space-y-4">
            <OtpBlock
              label={t("courier.job.deliveryOtp")}
              value={otp}
              onChange={setOtp}
              busy={verify.isPending}
              cta={t("courier.job.verify")}
              onSubmit={() => verify.mutate("delivery")}
            />

            <div className="rounded-[18px] border border-border bg-card p-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => { void onPickPhoto(e.target.files?.[0] ?? null); }}
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

            {!showIncident ? (
              <button
                type="button"
                onClick={() => setShowIncident(true)}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive)]/5 text-[14px] font-bold text-[color:var(--color-destructive)]"
              >
                <AlertTriangle className="h-4 w-4" />
                {t("courier.job.cantDeliver")}
              </button>
            ) : (
              <div className="rounded-[18px] border border-border bg-card p-4">
                <p className="text-[15px] font-bold text-foreground">{t("courier.job.incidentTitle")}</p>
                <ul className="mt-3 space-y-2">
                  {INCIDENT_CODES.map((code) => (
                    <li key={code}>
                      <button
                        type="button"
                        onClick={() => setIncidentCode(code)}
                        className={`flex h-11 w-full items-center rounded-[12px] border px-3 text-left text-[14px] font-semibold ${
                          incidentCode === code
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-foreground"
                        }`}
                      >
                        {t(`courier.incident.${code}` as TranslationKey)}
                      </button>
                    </li>
                  ))}
                </ul>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("courier.job.incidentNotes")}
                  rows={3}
                  className="mt-3 w-full rounded-[12px] border border-border bg-background p-3 text-[14px] text-foreground"
                />
                <button
                  type="button"
                  disabled={!incidentCode || report.isPending}
                  onClick={() => report.mutate()}
                  className="mt-3 flex h-[52px] w-full items-center justify-center rounded-[14px] bg-[color:var(--color-destructive)] font-bold text-white disabled:opacity-60"
                >
                  {report.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : t("courier.job.submitIncident")}
                </button>
              </div>
            )}
          </div>
        )}

        {canCancel ? (
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => {
              if (window.confirm(t("courier.job.cancelConfirm"))) cancel.mutate();
            }}
            className="mt-4 h-11 w-full rounded-[14px] border border-border bg-card text-[14px] font-semibold text-[color:var(--text-secondary)] disabled:opacity-60"
          >
            {t("courier.job.cancel")}
          </button>
        ) : !finished ? (
          <p className="mt-4 text-center text-[12px] text-[color:var(--text-secondary)]">{t("courier.job.noCancel")}</p>
        ) : null}
      </section>
    </div>
  );
}

function AddressCard({
  title,
  address,
  lat,
  lng,
  navigateLabel,
  highlight,
}: {
  title: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  navigateLabel: string;
  highlight: boolean;
}) {
  return (
    <div className={`rounded-[18px] border bg-card p-4 ${highlight ? "border-primary" : "border-border"}`}>
      <div className="flex items-start gap-2">
        <MapPin className={`mt-0.5 h-4 w-4 ${highlight ? "text-primary" : "text-[color:var(--text-secondary)]"}`} />
        <div className="flex-1">
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-[color:var(--text-secondary)]">{title}</p>
          <p className="text-[14px] font-semibold text-foreground">{address ?? "—"}</p>
        </div>
      </div>
      <a
        href={mapsUrl(lat, lng, address)}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex h-11 items-center justify-center gap-2 rounded-[12px] border border-border bg-background text-[14px] font-bold text-foreground"
      >
        <Navigation className="h-4 w-4 text-primary" />
        {navigateLabel}
      </a>
    </div>
  );
}

function ContactCard({ order, which, callLabel }: { order: CourierOrder; which: "pickup" | "drop"; callLabel: string }) {
  const name = which === "pickup" ? order.pickup_contact_name : order.drop_contact_name;
  const phone = which === "pickup" ? order.pickup_contact_phone : order.drop_contact_phone;
  if (!phone) return null;
  return (
    <section className="mt-3 px-6">
      <div className="flex items-center gap-3 rounded-[18px] border border-border bg-card p-4">
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-foreground">{name || phone}</p>
          <p className="text-[12px] text-[color:var(--text-secondary)]">{phone}</p>
        </div>
        <a
          href={`tel:${phone}`}
          className="flex h-11 items-center gap-2 rounded-[12px] bg-primary px-4 text-[14px] font-bold text-primary-foreground"
        >
          <Phone className="h-4 w-4" />
          {callLabel}
        </a>
      </div>
    </section>
  );
}

function OtpBlock({
  label,
  value,
  onChange,
  busy,
  cta,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  cta: string;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-[18px] border border-border bg-card p-4">
      <p className="text-[14px] font-semibold text-foreground">{label}</p>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className="mt-3 h-14 w-full rounded-[14px] border border-border bg-background text-center text-[24px] font-bold tracking-[0.5em] text-foreground"
      />
      <button
        type="button"
        disabled={busy || value.length < 4}
        onClick={onSubmit}
        className="mt-3 flex h-[52px] w-full items-center justify-center rounded-[14px] bg-primary font-bold text-primary-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : cta}
      </button>
    </div>
  );
}
