import { useCallback, useEffect, useState } from "react";
import { WifiOff, Loader2 } from "lucide-react";

/**
 * Full-screen branded no-connectivity state.
 *
 * Layer 1 of offline handling (mid-session): listens to @capacitor/network
 * when available plus the browser online/offline events, and confirms with a
 * lightweight reachability probe before blocking the UI. Auto-restores as
 * soon as connectivity comes back. Layer 2 (cold start) is public/offline.html.
 */
async function probeReachability(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    await fetch(`/favicon.png?ts=${Date.now()}`, { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

export function OfflineGate({ children }: { children: React.ReactNode }) {
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const ok = await probeReachability();
    setOffline(!ok);
    setChecking(false);
    return ok;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let removeNetworkListener: (() => void) | undefined;

    const onOnline = () => void check();
    const onOffline = () => setOffline(true);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    void (async () => {
      try {
        const { Network } = await import("@capacitor/network");
        const status = await Network.getStatus();
        if (!cancelled && !status.connected) setOffline(true);
        const handle = await Network.addListener("networkStatusChange", (s) => {
          if (cancelled) return;
          if (!s.connected) setOffline(true);
          else void check();
        });
        removeNetworkListener = () => void handle.remove();
      } catch {
        // Web build / plugin unavailable — browser events are enough.
      }
    })();

    const poll = window.setInterval(() => {
      if (offlineRef.current) void check();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      removeNetworkListener?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);

  // Keep the latest value readable inside the interval without resubscribing.
  const offlineRef = useState(() => ({ current: false }))[0];
  offlineRef.current = offline;

  if (!offline) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-b from-[#0058B0] to-[#0074E4] px-6 pb-[max(env(safe-area-inset-bottom),2rem)] pt-[var(--safe-top)] text-center text-white">
      <div className="flex h-[84px] w-[84px] items-center justify-center rounded-full bg-white/15">
        <WifiOff className="h-10 w-10" strokeWidth={2} />
      </div>
      <h1 className="mt-6 text-[22px] font-extrabold">No internet connection</h1>
      <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-white/85">
        badiyos Partner needs an internet connection. Check your mobile data or Wi-Fi and try again.
      </p>
      <button
        type="button"
        onClick={() => void check()}
        disabled={checking}
        className="mt-8 flex h-[52px] w-full max-w-xs items-center justify-center rounded-[14px] bg-white text-[16px] font-bold text-[#0074E4] active:scale-[0.98] disabled:opacity-70"
      >
        {checking ? <Loader2 className="h-5 w-5 animate-spin" /> : "Try again"}
      </button>
    </div>
  );
}
