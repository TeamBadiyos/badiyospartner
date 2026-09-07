// Utilities for the Home-screen broadcast experience.
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Coords = { lat: number; lng: number };

// Haversine distance in km
export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type LocationState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "denied" }
  | { status: "unavailable"; message: string }
  | { status: "ok"; coords: Coords; updatedAt: number };

export type LocationTracker = {
  state: LocationState;
  lastPushedAt: number | null;
  /** True when the page is currently hidden/backgrounded. Tracking is paused. */
  isHidden: boolean;
  /**
   * Imperatively request a fresh fix and persist it. Resolves with coords on
   * success, or throws with a user-readable message on failure. Callers should
   * await this before flipping the expert to Online so a booking broadcast
   * during the toggle gap doesn't miss the expert.
   */
  ensureFix: () => Promise<Coords>;
};

async function pushLocation(coords: Coords): Promise<void> {
  const { error } = await supabase.rpc("expert_update_location", {
    p_lat: coords.lat,
    p_lng: coords.lng,
  });
  if (error) {
    console.error("[expert] expert_update_location failed", error);
    throw new Error(error.message || "Could not save location");
  }
}

// Hard timeout wrapper — some Android OEM WebViews silently drop the Capacitor
// bridge or hang forever waiting for a GPS fix. This guarantees the promise
// settles from the event loop so the UI can never get stuck.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let done = false;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      const err = new Error(`${label} timed out after ${ms}ms`) as Error & { code?: number };
      err.code = 3; // TIMEOUT
      reject(err);
    }, ms);
    Promise.resolve(p).then(
      (v) => { if (done) return; done = true; clearTimeout(t); resolve(v); },
      (e) => { if (done) return; done = true; clearTimeout(t); reject(e); },
    );
  });
}

/** Thrown when the OS will no longer show the permission prompt and the
 * expert must enable location from system Settings. */
export const LOCATION_BLOCKED = "LOCATION_BLOCKED";
/** Thrown when the expert declined the prompt this time. */
export const LOCATION_DENIED = "LOCATION_DENIED";

export function isLocationBlockedError(err: unknown): boolean {
  return (err as { code?: string })?.code === LOCATION_BLOCKED;
}

function permError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

/**
 * Re-runs the OS permission flow on EVERY attempt (no session caching), so a
 * previously-denied or revoked permission is asked for again. When Android has
 * hard-denied (the prompt will not appear anymore), throws LOCATION_BLOCKED so
 * the caller can direct the expert to app Settings.
 */
async function ensureNativeLocationPermission(): Promise<void> {
  let Capacitor: typeof import("@capacitor/core").Capacitor;
  try {
    ({ Capacitor } = await import("@capacitor/core"));
  } catch {
    return; // web — navigator.geolocation handles its own prompt
  }
  if (!Capacitor.isNativePlatform?.()) return;

  const { Geolocation } = await import("@capacitor/geolocation");

  let before: string | undefined;
  try {
    const status = await withTimeout(Geolocation.checkPermissions(), 5_000, "checkPermissions");
    before = status.location;
    if (before === "granted" || status.coarseLocation === "granted") return;
  } catch {
    // Fall through to a request attempt.
  }

  let after: string | undefined;
  try {
    const res = await withTimeout(
      Geolocation.requestPermissions({ permissions: ["location", "coarseLocation"] }),
      20_000,
      "requestPermissions",
    );
    after = res.location === "granted" || res.coarseLocation === "granted" ? "granted" : res.location;
  } catch {
    // Timed out (no dialog appeared) — treat as blocked so we can offer Settings.
    throw permError(
      LOCATION_BLOCKED,
      "Location permission is blocked. Enable it in Settings to go online.",
    );
  }

  if (after === "granted") return;

  // Android returns "denied" instantly without showing a dialog once the user
  // has hard-denied; detect that by the state being denied both before & after.
  if (before === "denied" || after === "denied") {
    throw permError(
      LOCATION_BLOCKED,
      "Location permission is blocked. Enable it in Settings to go online.",
    );
  }
  throw permError(LOCATION_DENIED, "Location permission denied.");
}


async function getCurrentPositionOnce(requestPermission = false): Promise<GeolocationPosition> {
  // On an explicit user action (going online) re-run the OS permission flow
  // every time so a previous denial can be corrected. On web this is a no-op.
  if (requestPermission) await ensureNativeLocationPermission();


  return withTimeout(
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        reject(new Error("Geolocation not supported on this device."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 },
      );
    }),
    15_000,
    "getCurrentPosition",
  );
}



// Tracks device geolocation while `enabled` is true and pushes it to Supabase
// on every fresh reading plus a 30s poll. Also exposes `ensureFix()` for the
// caller to await a fresh persisted fix before flipping Online.
export function useExpertLocationTracking(enabled: boolean): LocationTracker {
  const [state, setState] = useState<LocationState>({ status: "idle" });
  const [lastPushedAt, setLastPushedAt] = useState<number | null>(null);
  const [isHidden, setIsHidden] = useState<boolean>(
    typeof document !== "undefined" ? document.hidden : false,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const hiddenRef = useRef(isHidden);
  hiddenRef.current = isHidden;

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setState({ status: "ok", coords, updatedAt: Date.now() });
    return coords;
  }, []);

  const applyError = useCallback((err: GeolocationPositionError | Error) => {
    // Suppress geolocation errors while backgrounded / screen locked — browsers
    // throttle or time out watchPosition/getCurrentPosition when the tab is
    // hidden, and that's expected OS behavior, not a genuine failure.
    if (hiddenRef.current) return;
    if ("code" in err && err.code === err.PERMISSION_DENIED) {
      setState({ status: "denied" });
      return;
    }
    setState({
      status: "unavailable",
      message: (err as Error).message || "Location unavailable",
    });
  }, []);


  const ensureFix = useCallback(async (): Promise<Coords> => {
    setState((prev) => (prev.status === "ok" ? prev : { status: "requesting" }));
    try {
      const pos = await getCurrentPositionOnce(true);
      const coords = applyPosition(pos);
      await withTimeout(pushLocation(coords), 10_000, "pushLocation");
      setLastPushedAt(Date.now());
      return coords;
    } catch (err) {
      applyError(err as GeolocationPositionError | Error);
      const code = (err as { code?: string | number }).code;
      if (code === LOCATION_BLOCKED || code === LOCATION_DENIED) throw err;
      // Browser PERMISSION_DENIED (code 1) — on native this means the WebView
      // itself was refused even though the OS grant looked fine: treat as blocked.
      if (code === 1) {
        setState({ status: "denied" });
        throw permError(
          LOCATION_BLOCKED,
          "Location permission is blocked. Enable it in Settings to go online.",
        );
      }
      throw new Error((err as Error).message || "Could not get your location");
    }
  }, [applyPosition, applyError]);


  // Track page visibility so we can pause tracking while hidden (backgrounded
  // OR screen locked). On Android, screen lock reliably fires visibilitychange
  // via WebView; we also listen for pagehide/pageshow and window blur/focus as
  // belt-and-suspenders, and hook into the Capacitor App plugin when native.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const setHidden = (h: boolean) => {
      setIsHidden(h);
      if (!h) {
        // Coming back to foreground: clear any stale "unavailable" state so
        // we don't flash red before the next fix lands.
        setState((prev) =>
          prev.status === "unavailable" || prev.status === "idle"
            ? { status: "requesting" }
            : prev,
        );
      }
    };
    const onVis = () => setHidden(document.hidden);
    const onPageHide = () => setHidden(true);
    const onPageShow = () => setHidden(false);
    const onBlur = () => setHidden(true);
    const onFocus = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    let removeCapListeners: (() => void) | null = null;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform?.()) return;
        const { App } = await import("@capacitor/app");
        const pauseHandle = await App.addListener("pause", () => setHidden(true));
        const resumeHandle = await App.addListener("resume", () => setHidden(false));
        const stateHandle = await App.addListener("appStateChange", (s) => setHidden(!s.isActive));
        removeCapListeners = () => {
          pauseHandle.remove();
          resumeHandle.remove();
          stateHandle.remove();
        };
      } catch {
        // Plugin not available — web fallbacks above are enough.
      }
    })();

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      if (removeCapListeners) removeCapListeners();
    };
  }, []);


  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      setLastPushedAt(null);
      return;
    }
    // Pause tracking while the tab is hidden — keep last-known state intact.
    if (isHidden) return;

    let cancelled = false;
    let clearWatch: (() => void) | null = null;
    let interval: number | null = null;

    const onPosition = (pos: GeolocationPosition) => {
      if (cancelled) return;
      const coords = applyPosition(pos);
      pushLocation(coords)
        .then(() => setLastPushedAt(Date.now()))
        .catch((err) => console.error("[expert] location push failed", err));
    };
    const onError = (err: GeolocationPositionError | Error) => {
      if (cancelled) return;
      applyError(err);
    };

    const pollOnce = () => {
      getCurrentPositionOnce().then(onPosition).catch(onError);
    };

    (async () => {
      // Immediate refresh on enable/foreground. This also triggers the OS
      // permission dialog on first use (via triggerNativeOsPermissionDialog).
      pollOnce();

      if (typeof navigator !== "undefined" && navigator.geolocation) {
        const id = navigator.geolocation.watchPosition(onPosition, onError, {
          enableHighAccuracy: true,
          maximumAge: 30_000,
          timeout: 20_000,
        });
        clearWatch = () => navigator.geolocation.clearWatch(id);
      } else {
        setState({ status: "unavailable", message: "Geolocation not supported on this device." });
        return;
      }

      interval = window.setInterval(pollOnce, 30_000);
    })();


    return () => {
      cancelled = true;
      if (clearWatch) clearWatch();
      if (interval !== null) window.clearInterval(interval);
    };
  }, [enabled, isHidden, applyPosition, applyError]);

  return { state, lastPushedAt, isHidden, ensureFix };
}

// -----------------------------------------------------------------------------
// Sound loop (Web Audio synth — no asset needed, matches the "notification loop"
// pattern used elsewhere in Badiyo).
// -----------------------------------------------------------------------------
let sharedCtx: AudioContext | null = null;
const activeSources = new Set<{ stop: () => void }>();

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx) sharedCtx = new AC();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

export function startNotificationLoop(): { stop: () => void } {
  const ctx = getCtx();
  if (!ctx) return { stop: () => {} };
  let stopped = false;
  let timer: number | null = null;

  const beep = () => {
    if (stopped) return;
    // Resume in case the browser suspended the context while idle —
    // keeps the loop audible until stop() is explicitly called.
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  };

  // Fire immediately, then repeat continuously until stop() is called
  // (Accept / Reject / Dismiss / claimed by another expert).
  beep();
  timer = window.setInterval(beep, 750);

  const handle = {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer !== null) window.clearInterval(timer);
      activeSources.delete(handle);
    },
  };
  activeSources.add(handle);
  return handle;
}

export function stopAllNotificationLoops() {
  for (const s of Array.from(activeSources)) s.stop();
}
