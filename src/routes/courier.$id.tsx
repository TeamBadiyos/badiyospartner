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
  ArrowRight,
  X,
} from "lucide-react";
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

function stepIndex(status: string): number {
  if (status === "DRIVER_ASSIGNED") return 1;
  if (status === "ARRIVED_PICKUP") return 2;
  if (status === "PICKED_UP") return 3;
  return 4;
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
        <Link to="/home" className="mt-6 flex h-[52px] w-full max-w-xs items-center justify-center rounded-[14px] bg-primary font-bold text-primary-foreground">
          {t("courier.job.backHome")}
        </Link>
      </div>
    );
  }

  const st = order.status;
  const finished = !(COURIER_ACTIVE_STATUSES as readonly string[]).includes(st);
  const step = stepIndex(st);
  const earning = formatINR(riderEarning(order));

  if (finished) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center bg-background px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="h-10 w-10 text-primary" />
        </div>
        <h1 className="mt-5 text-[22px] font-bold text-foreground">{t("courier.job.doneTitle")}</h1>
        <p className="mt-2 text-[14px] text-[color:var(--text-secondary)]">{t("courier.job.doneSub", { amount: earning })}</p>
        <Link to="/home" className="mt-8 flex h-[54px] w-full items-center justify-center rounded-[16px] bg-primary text-[16px] font-bold text-primary-foreground">
          {t("courier.job.backHome")}
        </Link>
      </div>
    );
  }

  const pickupPhase = step <= 2;
  const contact = pickupPhase
    ? { name: order.pickup_contact_name, phone: order.pickup_contact_phone, label: t("courier.job.sender") }
    : { name: order.drop_contact_name, phone: order.drop_contact_phone, label: t("courier.job.receiver") };

  const heading =
    step === 1 ? t("courier.job.headPickup")
    : step === 2 ? t("courier.job.collect")
    : step === 3 ? t("courier.job.toDrop")
    : t("courier.job.handover");

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-30 bg-background px-5 pb-3 pt-[calc(var(--safe-top)+1rem)]">
        <div className="flex items-center gap-2">
          <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <div className="flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
              {t("courier.step.count", { n: step })} · {order.order_code ?? ""}
            </p>
            <h1 className="text-[19px] font-bold leading-tight text-foreground">{heading}</h1>
          </div>
          <div className="rounded-full bg-primary/10 px-3 py-1.5 text-right">
            <p className="amount-strong text-[15px] text-primary">{earning}</p>
          </div>
        </div>

        <Stepper step={step} labels={[t("courier.step.pickup"), t("courier.step.transit"), t("courier.step.delivered")]} />

        <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-muted/60 px-3 py-2">
          <Package className="h-4 w-4 text-primary" />
          <p className="flex-1 truncate text-[12px] font-semibold text-foreground">
            {order.package_description || t("courier.job.parcel")}
            {order.weight_kg != null ? ` · ${t("courier.job.weight", { kg: order.weight_kg })}` : ""}
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-5 pb-40 pt-1">
        {/* Focused address for the current phase */}
        <AddressCard
          title={pickupPhase ? t("courier.job.pickupTitle") : t("courier.job.dropTitle")}
          address={pickupPhase ? order.pickup_address : order.drop_address}
          lat={pickupPhase ? order.pickup_lat : order.drop_lat}
          lng={pickupPhase ? order.pickup_lng : order.drop_lng}
          navigateLabel={t("courier.job.navigate")}
        />

        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="flex items-center gap-3 rounded-[18px] border border-border bg-card p-4 card-lift"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Phone className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[color:var(--text-secondary)]">{contact.label}</p>
              <p className="text-[14px] font-semibold text-foreground">{contact.name || contact.phone}</p>
            </div>
            <span className="text-[13px] font-bold text-primary">{t("courier.job.call")}</span>
          </a>
        )}

        {pickupPhase && order.drop_address && (
          <div className="flex items-center gap-2 rounded-[14px] border border-dashed border-border px-4 py-3">
            <ArrowRight className="h-4 w-4 text-[color:var(--text-secondary)]" />
            <p className="flex-1 truncate text-[12px] text-[color:var(--text-secondary)]">
              <span className="font-bold">{t("courier.job.nextStop")}:</span> {order.drop_address}
            </p>
          </div>
        )}

        {step === 2 && (
          <OtpBlock label={t("courier.job.askPickupOtp")} value={otp} onChange={setOtp} />
        )}

        {step === 4 && (
          <>
            <OtpBlock label={t("courier.job.askDeliveryOtp")} value={otp} onChange={setOtp} />
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
            <button
              type="button"
              onClick={() => setShowIncident(true)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] text-[13px] font-bold text-[color:var(--color-destructive)]"
            >
              <AlertTriangle className="h-4 w-4" />
              {t("courier.job.reportIssue")}
            </button>
          </>
        )}

        {step === 1 ? (
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => { if (window.confirm(t("courier.job.cancelConfirm"))) cancel.mutate(); }}
            className="h-11 w-full rounded-[14px] text-[13px] font-semibold text-[color:var(--text-secondary)] disabled:opacity-60"
          >
            {t("courier.job.cancel")}
          </button>
        ) : (
          <p className="pt-1 text-center text-[12px] text-[color:var(--text-secondary)]">{t("courier.job.noCancel")}</p>
        )}
      </main>

      {/* Sticky single action for the current step */}
      <div className="sticky bottom-0 z-30 border-t border-border bg-background/95 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 backdrop-blur">
        {step === 1 && (
          <PrimaryAction
            busy={arrive.isPending}
            label={t("courier.job.arrived")}
            onClick={() => { hapticImpact("medium"); arrive.mutate(); }}
          />
        )}
        {step === 2 && (
          <PrimaryAction
            busy={verify.isPending}
            disabled={otp.length < 4}
            label={t("courier.job.verifyCollect")}
            onClick={() => verify.mutate("pickup")}
          />
        )}
        {step === 3 && (
          <PrimaryAction
            busy={startTransit.isPending}
            label={t("courier.job.startTransit")}
            onClick={() => { hapticImpact("medium"); startTransit.mutate(); }}
          />
        )}
        {step === 4 && (
          <PrimaryAction
            busy={verify.isPending}
            disabled={otp.length < 4}
            label={t("courier.job.completeWith", { amount: earning })}
            onClick={() => verify.mutate("delivery")}
          />
        )}
      </div>

      {showIncident && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={() => setShowIncident(false)}>
          <div
            className="w-full rounded-t-[22px] bg-card p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold text-foreground">{t("courier.job.incidentTitle")}</p>
              <button type="button" onClick={() => setShowIncident(false)} className="rounded-full p-1 text-[color:var(--text-secondary)]">
                <X className="h-5 w-5" />
              </button>
            </div>
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
        </div>
      )}
    </div>
  );
}

function Stepper({ step, labels }: { step: number; labels: string[] }) {
  // 4 statuses map onto 3 visible milestones.
  const reached = [step >= 2, step >= 3, false];
  return (
    <div className="mt-3 flex items-center gap-1">
      {labels.map((label, i) => (
        <div key={label} className="flex flex-1 flex-col gap-1">
          <div className={`h-1.5 rounded-full ${reached[i] ? "bg-primary" : i === reached.filter(Boolean).length ? "bg-primary/40" : "bg-muted"}`} />
          <span className={`text-[10px] font-bold uppercase tracking-[0.04em] ${reached[i] ? "text-primary" : "text-[color:var(--text-secondary)]"}`}>
            {label}
          </span>
        </div>
      ))}
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

function AddressCard({
  title,
  address,
  lat,
  lng,
  navigateLabel,
}: {
  title: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  navigateLabel: string;
}) {
  return (
    <div className="rounded-[18px] border border-primary/40 bg-card p-4 card-lift">
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[color:var(--text-secondary)]">{title}</p>
          <p className="text-[16px] font-semibold leading-snug text-foreground">{address ?? "—"}</p>
        </div>
      </div>
      <a
        href={mapsUrl(lat, lng, address)}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex h-12 items-center justify-center gap-2 rounded-[14px] bg-primary/10 text-[14px] font-bold text-primary"
      >
        <Navigation className="h-4 w-4" />
        {navigateLabel}
      </a>
    </div>
  );
}

function OtpBlock({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-[18px] border border-border bg-card p-4">
      <p className="text-[14px] font-semibold text-foreground">{label}</p>
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
