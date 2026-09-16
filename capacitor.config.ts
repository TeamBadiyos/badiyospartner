import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor config for the badiyos Partner native shell.
// The Android/iOS projects are generated locally with `npx cap add` and are
// NOT committed to this repo — this file is the source of truth for their
// runtime configuration.
//
// LIVE MODE: the shell loads https://expert.badiyos.com directly instead of
// the bundled `dist/` output, so web-layer changes ship on the next app open
// without a new APK. `server.errorPath` points at the bundled offline page so
// a cold start without connectivity still shows a branded screen.
//
// IMPORTANT: this host MUST be a live, published domain for this project.
// partner.badiyos.com does NOT resolve — pointing the shell there makes the
// app die right after the splash screen.
const config: CapacitorConfig = {
  appId: "com.badiyos.partner",
  appName: "badiyos Partner",
  webDir: "dist",
  server: {
    url: "https://expert.badiyos.com",
    cleartext: false,
    androidScheme: "https",
    iosScheme: "https",
    errorPath: "offline.html",
    allowNavigation: ["expert.badiyos.com", "badiyosexpert.lovable.app"],
  },
  android: {
    backgroundColor: "#0074E4",
  },
  ios: {
    backgroundColor: "#0074E4",
  },
  backgroundColor: "#0074E4",
  plugins: {
    StatusBar: {
      // Do not draw content underneath the OS status bar. The webview is
      // resized so the top of the app starts below the clock/wifi/battery row.
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#0074E4",
    },
  },
};

export default config;
