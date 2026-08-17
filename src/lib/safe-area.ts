// Android WebViews frequently report var(--safe-top) as 0 even when
// the status bar is visible, so headers end up under the clock/battery row.
// We measure the real inset at runtime and expose it as --safe-top-min, then
// --safe-top = max(var(--safe-top), --safe-top-min).

const FALLBACK_PX = 28;

let started = false;

function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

function measure(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // Read whatever the platform reports through the CSS env var.
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;height:var(--safe-top);width:0;visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  const reported = probe.getBoundingClientRect().height;
  probe.remove();

  if (!isNativeShell()) {
    // Browsers (and iOS, which reports correctly) need no synthetic inset.
    root.style.setProperty("--safe-top-min", `${Math.round(reported)}px`);
    return;
  }

  // Native Android: fall back to a sensible status-bar height when the
  // platform reports nothing.
  const dpr = window.devicePixelRatio || 1;
  const guess = reported > 0 ? reported : Math.max(FALLBACK_PX, Math.round(24 * Math.min(dpr, 1.5)));
  root.style.setProperty("--safe-top-min", `${Math.round(guess)}px`);
}

/** Measure now and keep --safe-top-min in sync with rotation / resize. */
export function initSafeArea(): void {
  if (typeof window === "undefined" || started) return;
  started = true;

  measure();
  // Re-measure once the status-bar overlay call has settled.
  window.setTimeout(measure, 300);
  window.setTimeout(measure, 1200);

  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", () => window.setTimeout(measure, 250));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) measure();
  });
}

/** Call after StatusBar.setOverlaysWebView so the inset reflects the new layout. */
export function remeasureSafeArea(): void {
  measure();
}
