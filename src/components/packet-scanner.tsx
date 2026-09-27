import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Keyboard, Loader2, ScanLine, XCircle } from "lucide-react";
import { printedPacketCode, scanPacket, type ScanResult, type TripPacket } from "@/lib/courier";
import { hapticNotification } from "@/lib/haptics";
import { useT } from "@/lib/i18n";

type Props = {
  orderId: string;
  stopId: string;
  stage: "pickup" | "drop";
  title: string;
  scanned: number;
  total: number;
  packets: TripPacket[];
  onScanned: () => void;
};

type Msg = { ok: boolean; text: string };

const CAMERA_DEBOUNCE_MS = 2000;

/** Match a typed/scanned code to a packet (BDY1045217 / 1045217 / 104521-7). */
function findPacket(packets: TripPacket[], raw: string) {
  const c = raw.trim().toUpperCase();
  const digits = c.replace(/^BDY/, "").replace(/[^0-9]/g, "");
  return packets.find((p) => p.code.toUpperCase() === c || (digits.length === 7 && p.code === digits));
}

export function PacketScanner({ orderId, stopId, stage, title, scanned, total, packets, onScanned }: Props) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busyRef = useRef(false);
  const packetsRef = useRef(packets);
  packetsRef.current = packets;

  const describe = (r: ScanResult, raw: string): Msg => {
    if (r.result === "ok") {
      const p = findPacket(packetsRef.current, raw);
      const extra = [p ? printedPacketCode(p) : null, r.drop_label].filter(Boolean).join(" · ");
      return { ok: true, text: extra ? `${t("courier.scan.ok")} · ${extra}` : t("courier.scan.ok") };
    }
    if (r.result === "wrong_stop")
      return { ok: false, text: t("courier.scan.wrong_stop", { label: r.drop_label ?? t("courier.scan.otherDrop") }) };
    return { ok: false, text: t(`courier.scan.${r.result}`) };
  };

  const submit = async (raw: string, method: "scan" | "manual") => {
    const c = raw.trim().toUpperCase();
    if (!c || busyRef.current) return;
    if (method === "scan") {
      const now = Date.now();
      if (lastRef.current.code === c && now - lastRef.current.at < CAMERA_DEBOUNCE_MS) return;
      lastRef.current = { code: c, at: now };
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await scanPacket(orderId, c, stage, stopId, method);
      const m = describe(r, c);
      setMsg(m);
      hapticNotification(m.ok ? "success" : "error");
      if (m.ok && method === "manual") setCode("");
      onScanned();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      hapticNotification("error");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!cameraOn) return;
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        if (cancelled || !videoRef.current) return;
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current,
          (result) => {
            if (result) void submit(result.getText(), "scan");
          },
        );
        if (cancelled) controls.stop();
      } catch {
        setMsg({ ok: false, text: t("courier.scan.cameraError") });
        setCameraOn(false);
        setTyping(true);
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, stopId]);

  const done = total > 0 && scanned >= total;
  useEffect(() => {
    if (done) setCameraOn(false);
  }, [done]);

  return (
    <div className="rounded-[18px] border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-bold text-foreground">{title}</p>
        <span className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${done ? "bg-primary/10 text-primary" : "bg-muted text-foreground"}`}>
          {t("courier.scan.counter", { n: scanned, total })}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${total ? (scanned / total) * 100 : 0}%` }} />
      </div>

      {done ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-[color:var(--success)]">
          <CheckCircle2 className="h-4 w-4" /> {t("courier.scan.done")}
        </p>
      ) : (
        <>
          {cameraOn && (
            <div className="relative mt-3 overflow-hidden rounded-[14px] bg-muted">
              <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
              <div className="pointer-events-none absolute inset-8 rounded-[12px] border-2 border-primary/80" />
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCameraOn((v) => !v)}
              className="flex h-11 items-center justify-center gap-2 rounded-[14px] bg-primary text-[14px] font-bold text-primary-foreground"
            >
              <ScanLine className="h-4 w-4" />
              {cameraOn ? t("courier.scan.close") : t("courier.scan.open")}
            </button>
            <button
              type="button"
              onClick={() => setTyping((v) => !v)}
              className="flex h-11 items-center justify-center gap-2 rounded-[14px] border border-border bg-background text-[14px] font-bold text-foreground"
            >
              <Keyboard className="h-4 w-4 text-primary" />
              {t("courier.scan.typeNumber")}
            </button>
          </div>
          {typing && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(code, "manual");
              }}
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, ""))}
                placeholder={t("courier.scan.numberPlaceholder")}
                inputMode="numeric"
                autoComplete="off"
                className="h-11 min-w-0 flex-1 rounded-[14px] border border-border bg-background px-3 text-[15px] font-semibold tracking-wider text-foreground outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={!code.trim() || busy}
                className="h-11 rounded-[14px] bg-primary px-4 text-[14px] font-bold text-primary-foreground disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("courier.scan.submit")}
              </button>
            </form>
          )}
          <p className="mt-2 text-[12px] text-muted-foreground">{t("courier.scan.needAll")}</p>
        </>
      )}

      {msg && (
        <p
          className={`mt-3 flex items-center gap-2 rounded-[12px] px-3 py-2 text-[13px] font-semibold ${
            msg.ok ? "bg-[color:var(--success-soft)] text-[color:var(--success)]" : "bg-destructive/10 text-destructive"
          }`}
        >
          {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
        </p>
      )}

      {packets.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            {stage === "drop"
              ? t("courier.scan.shopPackets", { n: packets.length })
              : t("courier.scan.tripPackets", { n: packets.length })}
          </p>
          <ul className="mt-2 space-y-1.5">
            {packets.map((p) => {
              const at = stage === "pickup" ? p.scanned_pickup_at : p.scanned_drop_at;
              const method = stage === "pickup" ? p.pickup_entry_method : p.drop_entry_method;
              return (
                <li key={p.id} className="flex items-center gap-2 text-[13px]">
                  {at ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[color:var(--success)]" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-semibold tracking-wider text-foreground">{printedPacketCode(p)}</span>
                  {stage === "pickup" && p.drop_label && <span className="text-muted-foreground">· {p.drop_label}</span>}
                  {at && method === "manual" && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                      {t("courier.scan.manualTag")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
