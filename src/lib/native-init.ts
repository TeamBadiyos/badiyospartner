// Native (Capacitor) startup hooks. No-ops on the web build.
let initialized = false;

export async function initNativeShell(): Promise<void> {
  if (initialized) return;
  initialized = true;

  let Capacitor: typeof import("@capacitor/core").Capacitor | null = null;
  try {
    const mod = await import("@capacitor/core");
    Capacitor = mod.Capacitor;
  } catch {
    return;
  }
  if (!Capacitor?.isNativePlatform?.()) return;

  // Share the current Supabase URL + publishable key with native Android code
  // (SupabaseRpc / BackgroundAvailabilityService read "CapacitorStorage" on
  // each call), so a web republish updates them without a new APK.
  try {
    const { SUPABASE_API_URL } = await import("@/integrations/supabase/api-url");
    const url = SUPABASE_API_URL || import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const { Preferences } = await import("@capacitor/preferences");
    if (url) await Preferences.set({ key: "supabase_url", value: url });
    if (key) await Preferences.set({ key: "supabase_anon_key", value: key });
  } catch (err) {
    console.warn("[native] saving Supabase config failed", err);
  }

  // Status bar: prevent the webview from rendering underneath the OS status
  // bar so the header/logo aren't clipped by the clock/wifi/battery row.
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#0074E4" });
    const { remeasureSafeArea } = await import("./safe-area");
    remeasureSafeArea();
    setTimeout(remeasureSafeArea, 400);
  } catch (err) {
    console.warn("[native] StatusBar init failed", err);
  }
}
