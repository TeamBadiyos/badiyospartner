// Thin wrapper around @capacitor/haptics. All calls are safe no-ops on the
// web build (plugin unavailable / not a native platform).
type Style = "light" | "medium" | "heavy";

let disabled = false;

async function withHaptics<T>(fn: (mod: typeof import("@capacitor/haptics")) => Promise<T>) {
  if (disabled) return;
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor?.isNativePlatform?.()) {
      disabled = true;
      return;
    }
    const mod = await import("@capacitor/haptics");
    await fn(mod);
  } catch {
    disabled = true;
  }
}

export function hapticImpact(style: Style = "light") {
  void withHaptics(async ({ Haptics, ImpactStyle }) => {
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] });
  });
}

export function hapticSelection() {
  void withHaptics(async ({ Haptics }) => {
    await Haptics.selectionStart();
    await Haptics.selectionChanged();
    await Haptics.selectionEnd();
  });
}

export function hapticNotification(type: "success" | "warning" | "error" = "success") {
  void withHaptics(async ({ Haptics, NotificationType }) => {
    const map = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    };
    await Haptics.notification({ type: map[type] });
  });
}
