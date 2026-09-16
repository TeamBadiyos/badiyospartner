// JS bridge to the native BackgroundLocationPlugin (Android only).
// No-op on web / iOS — returns a "not available" state so the UI can hide itself.
import { registerPlugin, Capacitor } from "@capacitor/core";

export type BgLocationStatus = {
  foreground: boolean;
  background: boolean;
  /** True when the device's Location toggle (GPS) is ON. */
  locationEnabled?: boolean;
  sdkInt: number;
  /** True on Android 11+ where request() cannot open a dialog — must openSettings(). */
  mustUseSettings: boolean;
  /** True if the native plugin isn't available (web/iOS or plugin not installed). */
  unavailable?: boolean;
};

export type BgLocationRequestResult = {
  granted: boolean;
  reason?: "foreground_not_granted" | "must_open_settings" | "denied";
};

interface BackgroundLocationPlugin {
  check(): Promise<Omit<BgLocationStatus, "unavailable">>;
  request(): Promise<BgLocationRequestResult>;
  openSettings(): Promise<void>;
  isLocationEnabled(): Promise<{ enabled: boolean }>;
  isFirebaseAvailable(): Promise<{ available: boolean }>;
  openLocationSettings(): Promise<void>;
  promptEnableLocation(): Promise<{ enabled: boolean; resolvable: boolean }>;
  startBackgroundService(): Promise<{ started: boolean; reason?: string }>;
  stopBackgroundService(): Promise<{ stopped: boolean }>;
}

const Plugin = registerPlugin<BackgroundLocationPlugin>("BackgroundLocation");

function isAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform?.() && Capacitor.getPlatform?.() === "android";
  } catch {
    return false;
  }
}

export async function checkBackgroundLocation(): Promise<BgLocationStatus> {
  if (!isAndroid()) {
    return { foreground: false, background: false, sdkInt: 0, mustUseSettings: false, unavailable: true };
  }
  try {
    return await Plugin.check();
  } catch (err) {
    console.warn("[bg-location] check failed", err);
    return { foreground: false, background: false, sdkInt: 0, mustUseSettings: false, unavailable: true };
  }
}

/**
 * Whether the device's Location (GPS) master switch is ON — independent of
 * whether the app holds location permission. Returns true on web/iOS (where
 * we can't tell) so the caller never blocks the flow there.
 */
export async function isDeviceLocationEnabled(): Promise<boolean> {
  if (!isAndroid()) return true;
  try {
    const res = await Plugin.isLocationEnabled();
    return res?.enabled !== false;
  } catch (err) {
    console.warn("[bg-location] isLocationEnabled failed", err);
    return true; // fail open — never block going online on a bridge error
  }
}

/**
 * Whether Firebase is initialized natively (google-services.json present at
 * build time). PushNotifications.register() crashes the whole process when it
 * is not, so push init MUST be gated on this. Returns false on any doubt.
 */
export async function isNativeFirebaseAvailable(): Promise<boolean> {
  if (!isAndroid()) return true; // web push / iOS unaffected
  try {
    const res = await Plugin.isFirebaseAvailable();
    return res?.available === true;
  } catch (err) {
    console.warn("[bg-location] isFirebaseAvailable failed", err);
    return false;
  }
}

/**
 * Fallback path that does NOT depend on our hand-merged native plugin.
 * Uses the capacitor-native-settings plugin, so if the custom plugin is
 * missing from the installed build the buttons still work.
 */
async function openViaNativeSettings(which: "location" | "app"): Promise<boolean> {
  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import("capacitor-native-settings");
    await NativeSettings.open({
      optionAndroid: which === "location" ? AndroidSettings.Location : AndroidSettings.ApplicationDetails,
      optionIOS: IOSSettings.App,
    });
    return true;
  } catch (err) {
    console.warn("[bg-location] native-settings fallback failed", which, err);
    return false;
  }
}

/**
 * Deep-links to the phone's Location settings page (not app settings).
 * Returns false when the page could not be opened (web/iOS or bridge error)
 * so the caller can show an explanatory message instead of doing nothing.
 */
export async function openDeviceLocationSettings(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    await Plugin.openLocationSettings();
    return true;
  } catch (err) {
    console.warn("[bg-location] openLocationSettings failed", err);
    return openViaNativeSettings("location");
  }
}

/**
 * Shows Google's in-app "Turn on location?" dialog. Resolves with
 * `enabled: true` once the device Location toggle is on.
 * `resolvable: false` means the dialog could not be shown (no Play services,
 * web/iOS, or plugin missing) — caller should fall back to opening settings.
 */
export async function promptEnableDeviceLocation(): Promise<{ enabled: boolean; resolvable: boolean }> {
  if (!isAndroid()) return { enabled: false, resolvable: false };
  try {
    const res = await Plugin.promptEnableLocation();
    return { enabled: !!res?.enabled, resolvable: res?.resolvable !== false };
  } catch (err) {
    console.warn("[bg-location] promptEnableLocation failed", err);
    return { enabled: false, resolvable: false };
  }
}

export async function requestBackgroundLocation(): Promise<BgLocationRequestResult> {
  if (!isAndroid()) return { granted: false, reason: "must_open_settings" };
  return Plugin.request();
}

/** Opens this app's system settings page. Returns false when it could not
 * be opened (web/iOS or bridge error) so the UI can explain what happened. */
export async function openAppLocationSettings(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    await Plugin.openSettings();
    return true;
  } catch (err) {
    console.warn("[bg-location] openSettings failed", err);
    return false;
  }
}

/** Starts the sticky foreground service. Safe no-op on web/iOS or when
 * background permission isn't granted (native side re-checks and refuses). */
export async function startBackgroundAvailabilityService(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    const res = await Plugin.startBackgroundService();
    return !!res?.started;
  } catch (err) {
    console.warn("[bg-location] startBackgroundService failed", err);
    return false;
  }
}

export async function stopBackgroundAvailabilityService(): Promise<void> {
  if (!isAndroid()) return;
  try {
    await Plugin.stopBackgroundService();
  } catch (err) {
    console.warn("[bg-location] stopBackgroundService failed", err);
  }
}
