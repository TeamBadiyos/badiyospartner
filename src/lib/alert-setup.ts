// JS bridge to the native AlertSetupPlugin (Android only). Feature-detected:
// older APKs without the plugin report `unavailable` and the UI falls back
// to written steps.
import { registerPlugin, Capacitor } from "@capacitor/core";

export type AlertSetupStatus = {
  unavailable?: boolean;
  sdkInt: number;
  manufacturer: string;
  notifications: boolean;
  fullScreen: boolean;
  fullScreenRequiresSetting: boolean;
  batteryUnrestricted: boolean;
  dndAccess: boolean;
  dndOn: boolean;
};

export type OemSettingKind = "xiaomi_autostart" | "xiaomi_popup" | "vivo" | "oppo" | "realme" | "samsung";

interface AlertSetupPlugin {
  status(): Promise<Omit<AlertSetupStatus, "unavailable">>;
  openFullScreenSettings(): Promise<{ opened: boolean }>;
  openDndAccessSettings(): Promise<{ opened: boolean }>;
  openNotificationSettings(): Promise<{ opened: boolean }>;
  openBatteryOptimisation(): Promise<{ opened: boolean }>;
  openOemSetting(o: { kind: OemSettingKind }): Promise<{ opened: boolean }>;
}

const Plugin = registerPlugin<AlertSetupPlugin>("AlertSetup");

const UNAVAILABLE: AlertSetupStatus = {
  unavailable: true,
  sdkInt: 0,
  manufacturer: "",
  notifications: false,
  fullScreen: false,
  fullScreenRequiresSetting: false,
  batteryUnrestricted: false,
  dndAccess: false,
  dndOn: false,
};

function isAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform?.() && Capacitor.getPlatform?.() === "android";
  } catch {
    return false;
  }
}

export async function getAlertSetupStatus(): Promise<AlertSetupStatus> {
  if (!isAndroid()) return UNAVAILABLE;
  try {
    return await Plugin.status();
  } catch {
    return UNAVAILABLE;
  }
}

type OpenFn = "openFullScreenSettings" | "openDndAccessSettings" | "openNotificationSettings" | "openBatteryOptimisation";

export async function openAlertSetting(fn: OpenFn): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    const r = await Plugin[fn]();
    return r?.opened !== false;
  } catch {
    return false;
  }
}

export async function openOemSetting(kind: OemSettingKind): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    const r = await Plugin.openOemSetting({ kind });
    return r?.opened !== false;
  } catch {
    return false;
  }
}

const SEEN_KEY = "badiyo.alertSetupPrompted.v1";

/**
 * One-time prompt: true when full-screen alerts are blocked (Android 14+) or
 * DND is on without policy access, and we haven't shown the setup screen yet.
 */
export function shouldPromptAlertSetup(s: AlertSetupStatus): boolean {
  if (s.unavailable) return false;
  try {
    if (localStorage.getItem(SEEN_KEY)) return false;
  } catch {
    return false;
  }
  return !s.fullScreen || (s.dndOn && !s.dndAccess);
}

export function markAlertSetupPrompted() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}
