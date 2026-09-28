import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw, X } from "lucide-react";
import { completeDropWithProof, ProofError, uploadDropProof, type DropProofResult } from "@/lib/courier";
import { hapticNotification } from "@/lib/haptics";
import { useT } from "@/lib/i18n";

type Fix = { lat: number; lng: number; accuracy: number; at: string };
type Shot = { id: string; blob: Blob; url: string; path?: string };

const MAX_PHOTOS = 5;
const MAX_SIDE = 1600;

function getFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject(new Error("no_gps"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: new Date(p.timestamp).toISOString() }),
      reject,
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
  });
}

type Props = {
  stopId: string;
  codes: string[];
  onDelivered: (r: DropProofResult) => void;
  onPacketsNotScanned: () => void;
  onAlreadyCompleted: () => void;
};

/** In-app live camera for signed/stamped bill photos on business drops. No gallery. */
export function BillPhotoCapture({ stopId, codes, onDelivered, onPacketsNotScanned, onAlreadyCompleted }: Props) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fixRef = useRef<Fix | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [firstNote, setFirstNote] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(() => () => {
    stopCamera();
    setShots((s) => {
      s.forEach((x) => URL.revokeObjectURL(x.url));
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
      getFix().then((f) => (fixRef.current = f)).catch(() => {});
    } catch {
      setCamError(t("courier.proof.cameraDenied"));
    }
  };

  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    const fix = fixRef.current;
    const fs = Math.max(14, Math.round(w / 55));
    const lines = [
      codes.join(", ").slice(0, 120),
      `${new Date().toLocaleString("en-IN")}${fix ? `  ·  ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} (±${Math.round(fix.accuracy)}m)` : ""}`,
    ];
    const pad = Math.round(fs * 0.5);
    const barH = lines.length * (fs + pad) + pad;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, h - barH, w, barH);
    ctx.fillStyle = "#fff"; // burned into the photo, not UI
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, pad, h - barH + pad + i * (fs + pad)));
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.75));
    if (!blob) return;
    hapticNotification("success");
    setShots((s) => {
      const next = [...s, { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) }];
      if (next.length >= MAX_PHOTOS) stopCamera();
      return next;
    });
    getFix().then((f) => (fixRef.current = f)).catch(() => {});
  };

  const remove = (id: string) => {
    setShots((s) => {
      const x = s.find((y) => y.id === id);
      if (x) URL.revokeObjectURL(x.url);
      return s.filter((y) => y.id !== id);
    });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setCanRetry(false);
    try {
      let fix: Fix;
      try {
        fix = await getFix();
      } catch {
        setError(t("courier.proof.noGps"));
        setCanRetry(true);
        return;
      }
      // Upload what isn't uploaded yet; keep paths so Retry doesn't re-upload.
      const paths: string[] = [];
      for (const s of shots) {
        if (s.path) {
          paths.push(s.path);
          continue;
        }
        const p = await uploadDropProof(stopId, s.blob);
        s.path = p;
        setShots((cur) => cur.map((c) => (c.id === s.id ? { ...c, path: p } : c)));
        paths.push(p);
      }
      const r = await completeDropWithProof(stopId, paths, fix);
      if (r?.ok) {
        stopCamera();
        onDelivered(r);
        return;
      }
      const reason = r?.reason ?? "";
      if (reason === "OUTSIDE_GEOFENCE") {
        const d = Math.round(Number(r.distance_m ?? 0));
        if (r.first_delivery) setFirstNote(true);
        setError(r.first_delivery ? t("courier.proof.farPin", { m: d }) : t("courier.proof.farShop", { m: d }));
        setCanRetry(true);
      } else if (reason === "packets_not_scanned") {
        setError(t("courier.proof.scanFirst"));
        onPacketsNotScanned();
      } else if (reason === "ALREADY_COMPLETED") {
        onAlreadyCompleted();
      } else if (reason === "PHOTO_NOT_FOUND") {
        shots.forEach((s) => (s.path = undefined));
        setError(t("courier.proof.uploadFailed"));
        setCanRetry(true);
      } else {
        setError(t("courier.proof.failed", { reason }));
        setCanRetry(true);
      }
    } catch (e) {
      if (e instanceof ProofError && e.reason === "ALREADY_COMPLETED") return onAlreadyCompleted();
      if (e instanceof ProofError && e.reason === "packets_not_scanned") {
        setError(t("courier.proof.scanFirst"));
        return onPacketsNotScanned();
      }
      setError(t("courier.proof.uploadFailed"));
      setCanRetry(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-[18px] border border-border bg-card p-4">
      <p className="text-[15px] font-bold text-foreground">{t("courier.proof.title")}</p>
      {firstNote && (
        <p className="rounded-[12px] bg-muted px-3 py-2 text-[12px] font-semibold text-foreground">{t("courier.proof.firstLocation")}</p>
      )}

      {cameraOn && (
        <div className="relative overflow-hidden rounded-[14px] bg-muted">
          <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover" />
          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={stopCamera}
              aria-label={t("courier.proof.closeCamera")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void capture()}
              aria-label={t("courier.proof.capture")}
              className="h-16 w-16 rounded-full border-4 border-background bg-primary"
            />
          </div>
        </div>
      )}

      {shots.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {shots.map((s) => (
            <div key={s.id} className="relative">
              <img src={s.url} alt="" className="aspect-square w-full rounded-[10px] object-cover" />
              {!busy && (
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  aria-label={t("courier.proof.retake")}
                  className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[12px] text-[color:var(--text-secondary)]">
        {t("courier.proof.count", { n: shots.length, max: MAX_PHOTOS })}
      </p>

      {!cameraOn && shots.length < MAX_PHOTOS && (
        <button
          type="button"
          onClick={() => void startCamera()}
          disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-background text-[14px] font-bold text-foreground disabled:opacity-60"
        >
          <Camera className="h-4 w-4 text-primary" />
          {shots.length ? t("courier.proof.addMore") : t("courier.proof.open")}
        </button>
      )}
      {camError && <p className="text-[13px] font-semibold text-destructive">{camError}</p>}
      {error && <p className="text-[13px] font-semibold text-destructive">{error}</p>}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || shots.length === 0}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[15px] font-bold text-primary-foreground disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : canRetry ? <RotateCcw className="h-4 w-4" /> : null}
        {busy ? t("courier.proof.uploading") : canRetry ? t("courier.proof.retry") : t("courier.proof.submit")}
      </button>
    </div>
  );
}
