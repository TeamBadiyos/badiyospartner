import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  MapPin,
  Phone,
  Loader2,
  Navigation2,
  X,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, formatINR } from "@/lib/expert-client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "@/lib/i18n";
import { useDurationCategoryIds, isDurationBased, serviceTitle } from "@/lib/service-pricing";
import { hapticImpact, hapticNotification } from "@/lib/haptics";
import { SlotChip } from "@/components/slot-chip";
import { OtpGreenKeypad } from "@/components/otp-green-keypad";
import { getFix } from "@/lib/courier";

export const Route = createFileRoute("/booking/$id")({
  head: () => ({
    meta: [
      { title: "Booking — badiyos Expert" },
      { name: "description", content: "Manage your assigned booking." },
    ],
  }),
  component: BookingScreen,
});

type Booking = {
  id: string;
  status: string;
  service_duration_minutes: number;
  service_label: string | null;
  service_category_id: string | null;
  price: number | null;
  address_id: string | null;
  assigned_expert_id: string | null;
  started_at: string | null;
  service_end_at: string | null;
  scheduled_date: string | null;
  scheduled_time_slot: string | null;
  user_id: string;
  created_at: string;
};

type Address = {
  full_address: string | null;
  area: string | null;
  city: string | null;
  landmark_photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
};

type Customer = { full_name: string | null; phone: string | null } | null;

/** Push a GPS fix every 15s while the expert is on the way (same as riders). */
function useJobLocationPing(active: boolean) {
  const busy = useRef(false);
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (busy.current) return;
      busy.current = true;
      getFix()
        .then(({ lat, lng }) =>
          supabase.rpc("expert_update_location", { p_lat: lat, p_lng: lng }),
        )
        .catch((err) => console.warn("[job] location ping failed", err))
        .finally(() => {
          busy.current = false;
        });
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [active]);
}

function BookingScreen() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const t = useT();
  const { loading: sessionLoading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);
  const [endPayout, setEndPayout] = useState<number | null>(null);

  const bookingQ = useQuery({
    queryKey: ["booking", id],
    enabled: !!expert?.id,
    refetchInterval: 20_000,
    queryFn: async (): Promise<Booking | null> => {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          "id, status, service_duration_minutes, service_label, service_category_id, price, address_id, assigned_expert_id, started_at, service_end_at, scheduled_date, scheduled_time_slot, user_id, created_at",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Booking | null;
    },
  });

  const booking = bookingQ.data;
  const isMine = !!booking && !!expert && booking.assigned_expert_id === expert.id;
  const status = booking?.status ?? "";

  const addressQ = useQuery({
    queryKey: ["address", booking?.address_id],
    enabled: !!booking?.address_id && isMine,
    queryFn: async (): Promise<Address | null> => {
      const { data, error } = await supabase
        .from("addresses")
        .select("full_address, area, city, landmark_photo_url, latitude, longitude")
        .eq("id", booking!.address_id!)
        .maybeSingle();
      if (error) throw error;
      return data as Address | null;
    },
  });

  const customerQ = useQuery({
    queryKey: ["customer", booking?.user_id],
    enabled: !!booking?.user_id && isMine,
    queryFn: async (): Promise<Customer> => {
      const { data, error } = await (supabase.rpc as any)("expert_get_booking_customer", {
        _booking_id: id,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as Customer;
    },
  });

  // Realtime updates for this booking
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`booking-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["booking", id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, qc]);

  // Live location while heading to the customer.
  useJobLocationPing(isMine && (status === "on_the_way" || status === "expert_assigned"));

  // The backend took the job away — leave the screen.
  const wasMine = useRef(false);
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    if (isMine && status !== "completed") wasMine.current = true;
  }, [isMine, status]);
  useEffect(() => {
    if (!booking || !expert || bookingQ.isLoading) return;
    const takenAway =
      wasMine.current &&
      (booking.assigned_expert_id !== expert.id || booking.status === "cancelled");
    if (!takenAway || removed) return;
    setRemoved(true);
    hapticNotification("warning");
    const timer = window.setTimeout(() => navigate({ to: "/home" }), 2200);
    return () => window.clearTimeout(timer);
  }, [booking, expert, bookingQ.isLoading, removed, navigate]);

  const reject = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc("expert_reject_booking", {
        _booking_id: id,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assigned-booking"] });
      navigate({ to: "/home" });
    },
  });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["booking", id] });
    qc.invalidateQueries({ queryKey: ["assigned-booking"] });
    qc.invalidateQueries({ queryKey: ["upcoming-jobs"] });
    qc.invalidateQueries({ queryKey: ["expert"] });
  }, [qc, id]);

  if (sessionLoading || !expert || bookingQ.isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (removed) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[color:var(--color-destructive)]/10">
          <AlertTriangle className="h-10 w-10 text-[color:var(--color-destructive)]" />
        </div>
        <h1 className="mt-5 text-[24px] font-extrabold text-foreground">
          {t("job.step.removedTitle")}
        </h1>
        <p className="mt-2 text-[15px] text-[color:var(--text-secondary)]">
          {t("job.step.removedSub")}
        </p>
        <Link
          to="/home"
          className="mt-8 flex h-[58px] w-full max-w-xs items-center justify-center rounded-[16px] bg-primary text-[17px] font-extrabold text-primary-foreground"
        >
          {t("job.notFound.back")}
        </Link>
      </div>
    );
  }

  if (!booking || !isMine) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[22px] font-bold text-foreground">{t("job.notFound.title")}</h1>
        <p className="mt-2 text-[14px] text-[color:var(--text-secondary)]">
          {t("job.notFound.sub")}
        </p>
        <Link
          to="/home"
          className="mt-6 flex h-[52px] w-full max-w-xs items-center justify-center rounded-[14px] bg-primary font-bold text-primary-foreground"
        >
          {t("job.notFound.back")}
        </Link>
      </div>
    );
  }

  const header = (
    <header className="sticky top-0 z-30 flex items-center justify-between bg-background px-6 pb-3 pt-[calc(var(--safe-top)+1.25rem)]">
      <Link
        to="/home"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
      >
        <ChevronLeft className="h-6 w-6" />
      </Link>
      {(status === "in_progress" || status === "arrived") && (
        <Link
          to="/sos"
          search={{ booking_id: id }}
          className="flex h-10 items-center gap-1 rounded-full bg-[color:var(--color-destructive)]/10 px-3 text-[13px] font-bold text-[color:var(--color-destructive)]"
        >
          <AlertTriangle className="h-4 w-4" /> SOS
        </Link>
      )}
    </header>
  );

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      {header}

      {status === "expert_assigned" && (
        <StepGo
          booking={booking}
          address={addressQ.data ?? null}
          addressLoading={addressQ.isLoading}
          onDone={refresh}
          onReject={(r) => reject.mutate(r)}
          rejecting={reject.isPending}
        />
      )}

      {status === "on_the_way" && (
        <StepOnTheWay
          booking={booking}
          address={addressQ.data ?? null}
          customer={customerQ.data ?? null}
          onDone={refresh}
        />
      )}

      {status === "arrived" && (
        <StepStartOtp booking={booking} customer={customerQ.data ?? null} onDone={refresh} />
      )}

      {status === "in_progress" && (
        <StepInProgress
          booking={booking}
          customer={customerQ.data ?? null}
          onDone={(payout) => {
            setEndPayout(payout);
            refresh();
          }}
        />
      )}

      {status === "completed" && <StepDone payout={endPayout} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function BigButton({
  children,
  onClick,
  disabled,
  tone = "primary",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "green" | "outline";
  type?: "button" | "submit";
}) {
  const tones = {
    primary: "bg-primary text-primary-foreground shadow-[var(--shadow-brand-sm)]",
    green: "bg-[#059669] text-white",
    outline: "border border-border bg-card text-foreground",
  } as const;
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={() => {
        hapticImpact("medium");
        onClick?.();
      }}
      className={`flex h-[66px] w-full items-center justify-center gap-2 rounded-[18px] text-[20px] font-extrabold tracking-wide active:scale-[0.98] transition disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function JobSummary({
  booking,
  address,
  addressLoading,
}: {
  booking: Booking;
  address: Address | null;
  addressLoading?: boolean;
}) {
  const t = useT();
  return (
    <div className="rounded-[20px] border border-border bg-card p-5">
      <h1 className="text-[24px] font-extrabold leading-tight text-foreground">
        {serviceTitle(booking.service_label, booking.service_duration_minutes)}
      </h1>
      <div className="mt-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
          <MapPin className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)]">
            {t("job.address.label")}
          </p>
          <p className="mt-1 text-[16px] font-bold text-foreground">
            {addressLoading
              ? t("job.address.loading")
              : (address?.full_address ?? t("job.address.unavailable"))}
          </p>
          {(address?.area || address?.city) && (
            <p className="mt-0.5 text-[14px] text-[color:var(--text-secondary)]">
              {[address?.area, address?.city].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
      </div>
      {address?.landmark_photo_url && (
        <img
          src={address.landmark_photo_url}
          alt="Landmark"
          className="mt-4 aspect-video w-full rounded-[14px] object-cover"
        />
      )}
    </div>
  );
}

function CustomerCard({
  customer,
  address,
}: {
  customer: Customer;
  address: Address | null;
}) {
  const t = useT();
  const mapHref =
    address?.latitude != null && address?.longitude != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${address.latitude},${address.longitude}`
      : address?.full_address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.full_address)}`
        : null;

  return (
    <div className="rounded-[20px] border border-border bg-card p-5">
      <p className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)]">
        {t("job.step.customer")}
      </p>
      <p className="mt-1 text-[24px] font-extrabold text-foreground">
        {customer?.full_name ?? "—"}
      </p>
      {customer?.phone && (
        <p className="mt-0.5 text-[17px] font-bold tracking-wide text-[color:var(--text-secondary)]">
          {customer.phone}
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <a
          href={customer?.phone ? `tel:${customer.phone}` : undefined}
          className={`flex h-[62px] items-center justify-center gap-2 rounded-[16px] bg-[#059669] text-[18px] font-extrabold text-white ${customer?.phone ? "" : "pointer-events-none opacity-40"}`}
        >
          <Phone className="h-6 w-6" /> {t("job.step.call")}
        </a>
        <a
          href={mapHref ?? undefined}
          target="_blank"
          rel="noreferrer"
          className={`flex h-[62px] items-center justify-center gap-2 rounded-[16px] bg-primary text-[18px] font-extrabold text-primary-foreground ${mapHref ? "" : "pointer-events-none opacity-40"}`}
        >
          <Navigation2 className="h-6 w-6" /> {t("job.step.map")}
        </a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — after Accept                                               */
/* ------------------------------------------------------------------ */

function StepGo({
  booking,
  address,
  addressLoading,
  onDone,
  onReject,
  rejecting,
}: {
  booking: Booking;
  address: Address | null;
  addressLoading: boolean;
  onDone: () => void;
  onReject: (reason: string) => void;
  rejecting: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  async function go() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("expert_mark_on_the_way", {
      p_booking_id: booking.id,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    hapticNotification("success");
    onDone();
  }

  return (
    <>
      <div className="flex flex-1 flex-col px-6">
        <SlotChip booking={booking} size="lg" className="self-start" />
        <div className="mt-4">
          <JobSummary booking={booking} address={address} addressLoading={addressLoading} />
        </div>

        <div className="mt-auto pt-6">
          {err && (
            <p className="mb-3 text-center text-[14px] font-bold text-[color:var(--color-destructive)]">
              {err}
            </p>
          )}
          <BigButton onClick={go} disabled={busy}>
            {busy ? t("job.step.going") : t("job.step.goNow")} <ArrowRight className="h-6 w-6" />
          </BigButton>
          <button
            onClick={() => {
              hapticImpact("light");
              setShowReject(true);
            }}
            className="mt-3 h-[52px] w-full rounded-[14px] border border-border bg-card text-[16px] font-bold text-foreground"
          >
            {t("job.reject")}
          </button>
        </div>
      </div>

      {showReject && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setShowReject(false)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full rounded-t-[24px] bg-card p-6 pb-8">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[18px] font-bold text-foreground">{t("job.reject.title")}</h3>
              <button onClick={() => setShowReject(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-[13px] text-[color:var(--text-secondary)]">{t("job.reject.sub")}</p>
            <div className="mt-4 space-y-2">
              {(
                [
                  ["Too far", "job.reject.reason.tooFar"],
                  ["Health issue", "job.reject.reason.health"],
                  ["Personal emergency", "job.reject.reason.emergency"],
                  ["Wrong service", "job.reject.reason.wrongService"],
                  ["Other", "job.reject.reason.other"],
                ] as const
              ).map(([r, key]) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`w-full rounded-[14px] border p-4 text-left text-[14px] font-semibold ${reason === r ? "border-primary bg-[color:var(--color-accent)] text-primary" : "border-border bg-card text-foreground"}`}
                >
                  {t(key)}
                </button>
              ))}
            </div>
            <button
              disabled={!reason || rejecting}
              onClick={() => {
                hapticNotification("warning");
                onReject(reason);
                navigate({ to: "/home" });
              }}
              className="mt-6 h-[52px] w-full rounded-[14px] bg-[color:var(--color-destructive)] text-[16px] font-bold text-white disabled:opacity-40"
            >
              {rejecting ? t("job.reject.rejecting") : t("job.reject.confirm")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — on the way                                                 */
/* ------------------------------------------------------------------ */

function StepOnTheWay({
  booking,
  address,
  customer,
  onDone,
}: {
  booking: Booking;
  address: Address | null;
  customer: Customer;
  onDone: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function arrived() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("expert_mark_arrived", { p_booking_id: booking.id });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    hapticNotification("success");
    onDone();
  }

  return (
    <div className="flex flex-1 flex-col px-6">
      <SlotChip booking={booking} size="lg" className="self-start" />
      <h1 className="mt-4 text-[26px] font-extrabold leading-tight text-foreground">
        {t("job.step.onway.title")}
      </h1>
      <p className="mt-1 text-[14px] font-semibold text-[color:var(--text-secondary)]">
        {t("job.step.onway.sub")}
      </p>

      <div className="mt-4">
        <CustomerCard customer={customer} address={address} />
      </div>

      <div className="mt-4 rounded-[20px] border border-border bg-card p-5">
        <p className="text-[12px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)]">
          {t("job.address.label")}
        </p>
        <p className="mt-1 text-[16px] font-bold text-foreground">
          {address?.full_address ?? t("job.address.unavailable")}
        </p>
      </div>

      <div className="mt-auto pt-6">
        {err && (
          <p className="mb-3 text-center text-[14px] font-bold text-[color:var(--color-destructive)]">
            {err}
          </p>
        )}
        <BigButton onClick={arrived} disabled={busy} tone="green">
          {busy ? t("job.step.going") : t("job.step.reached")} <CheckCircle2 className="h-6 w-6" />
        </BigButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — start OTP                                                  */
/* ------------------------------------------------------------------ */

function StepStartOtp({
  booking,
  customer,
  onDone,
}: {
  booking: Booking;
  customer: Customer;
  onDone: () => void;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Make sure the customer has a code to read out.
  useEffect(() => {
    void supabase.rpc("expert_ensure_booking_codes", { _booking_id: booking.id });
  }, [booking.id]);

  async function submit() {
    if (code.length !== 4) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("expert_verify_start_otp", {
      _booking_id: booking.id,
      _otp: code,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      hapticNotification("error");
      setCode("");
      return;
    }
    hapticNotification("success");
    onDone();
  }

  return (
    <div className="flex flex-1 flex-col px-6">
      <SlotChip booking={booking} className="self-start" />
      <h1 className="mt-4 text-[28px] font-extrabold leading-tight text-foreground">
        {t("job.step.startTitle")}
      </h1>
      <p className="mt-1 text-[15px] font-semibold text-[color:var(--text-secondary)]">
        {t("job.step.startSub")}
      </p>
      {customer?.full_name && (
        <p className="mt-2 text-[16px] font-bold text-foreground">{customer.full_name}</p>
      )}

      <div className="mt-6">
        <OtpGreenKeypad value={code} onChange={setCode} disabled={busy} />
      </div>

      {err && (
        <p className="mt-4 text-center text-[14px] font-bold text-[color:var(--color-destructive)]">
          {err}
        </p>
      )}

      <div className="mt-auto pt-6">
        <BigButton onClick={submit} disabled={busy || code.length !== 4} tone="green">
          {busy ? t("job.starting") : t("job.step.startBtn")}
        </BigButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Steps 4 & 5 — in progress + end OTP                                 */
/* ------------------------------------------------------------------ */

function StepInProgress({
  booking,
  customer,
  onDone,
}: {
  booking: Booking;
  customer: Customer;
  onDone: (payout: number | null) => void;
}) {
  const t = useT();
  const [showEnd, setShowEnd] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const { data: durationCategoryIds } = useDurationCategoryIds();
  const countsDown =
    isDurationBased(durationCategoryIds, booking.service_category_id) && !!booking.service_end_at;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = countsDown
    ? new Date(booking.service_end_at!).getTime() - now
    : now - new Date(booking.started_at ?? booking.created_at).getTime();
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const timeText =
    hh > 0
      ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
      : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;

  async function submit() {
    if (code.length !== 4) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("expert_verify_end_otp", {
      _booking_id: booking.id,
      _otp: code,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      hapticNotification("error");
      setCode("");
      return;
    }
    hapticNotification("success");
    const payout = Number(data);
    onDone(Number.isFinite(payout) ? payout : null);
  }

  if (showEnd) {
    return (
      <div className="flex flex-1 flex-col px-6">
        <h1 className="text-[28px] font-extrabold leading-tight text-foreground">
          {t("job.step.endTitle")}
        </h1>
        <p className="mt-1 text-[15px] font-semibold text-[color:var(--text-secondary)]">
          {t("job.step.endSub")}
        </p>

        <div className="mt-6">
          <OtpGreenKeypad value={code} onChange={setCode} disabled={busy} />
        </div>

        {err && (
          <p className="mt-4 text-center text-[14px] font-bold text-[color:var(--color-destructive)]">
            {err}
          </p>
        )}

        <div className="mt-auto pt-6">
          <BigButton onClick={submit} disabled={busy || code.length !== 4} tone="green">
            {busy ? t("job.completing") : t("job.step.endBtn")}
          </BigButton>
          <button
            onClick={() => {
              setShowEnd(false);
              setErr(null);
            }}
            className="mt-3 h-[52px] w-full rounded-[14px] border border-border bg-card text-[16px] font-bold text-foreground"
          >
            {t("job.step.backToWork")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col px-6">
      <SlotChip booking={booking} className="self-start" />

      <div className="mt-4 rounded-[22px] border-2 border-primary bg-[color:var(--color-accent)] p-6 text-center">
        {countsDown ? (
          <>
            <p className="text-[13px] font-extrabold uppercase tracking-wider text-primary">
              {t("job.step.left")}
            </p>
            <p className="mt-1 font-mono text-[52px] font-black leading-none text-primary">
              {timeText}
            </p>
          </>
        ) : (
          <p className="text-[26px] font-black leading-tight text-primary">
            {t("job.step.inProgress")} · {t("job.step.elapsedMin", { n: Math.floor(total / 60) })}
          </p>
        )}
        <p className="mt-2 text-[15px] font-bold text-primary/80">
          {serviceTitle(booking.service_label, booking.service_duration_minutes)}
        </p>
      </div>


      <div className="mt-auto pt-6">
        <BigButton onClick={() => setShowEnd(true)} tone="green">
          {t("job.step.openEndCode")}
        </BigButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 6 — done                                                       */
/* ------------------------------------------------------------------ */

function StepDone({ payout }: { payout: number | null }) {
  const t = useT();
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="flex h-28 w-28 items-center justify-center rounded-full bg-[#ECFDF5]">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#059669] text-4xl text-white">
          ✓
        </div>
      </div>
      <h2 className="mt-6 text-[30px] font-black text-foreground">{t("job.step.donePoora")}</h2>

      {payout != null && payout > 0 && (
        <div className="mt-6 w-full rounded-[20px] border-2 border-[#10B981] bg-[#ECFDF5] p-6">
          <p className="text-[13px] font-extrabold uppercase tracking-wider text-[#065F46]">
            {t("job.step.doneEarned")}
          </p>
          <p className="mt-1 text-[42px] font-black leading-none text-[#065F46]">
            {formatINR(payout)}
          </p>
        </div>
      )}

      <p className="mt-4 max-w-xs text-[15px] text-[color:var(--text-secondary)]">
        {t("job.step.doneSub")}
      </p>

      <div className="mt-8 flex w-full gap-3">
        <Link
          to="/wallet"
          className="flex h-[58px] flex-1 items-center justify-center rounded-[16px] border border-border bg-card text-[16px] font-extrabold text-foreground"
        >
          {t("job.done.wallet")}
        </Link>
        <Link
          to="/home"
          className="flex h-[58px] flex-1 items-center justify-center rounded-[16px] bg-primary text-[16px] font-extrabold text-primary-foreground"
        >
          {t("job.done.home")}
        </Link>
      </div>
    </section>
  );
}
