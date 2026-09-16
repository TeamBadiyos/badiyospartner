# Turn location on from inside the app

Right now tapping "Open Settings" shows the red message "Couldn't open settings automatically". The button talks to a piece of code that must be compiled into the installed app; in the APK you are testing it is missing (the app was renamed), so the call fails and only the error message appears.

## What will change

### 1. The popup comes automatically

- When you tap "Tap to go online" and the phone's location switch is off (even though permission is allowed), the standard Google "Turn on location? — OK / No thanks" popup appears immediately inside the app. No banner to tap first.
- Tap OK and location switches on, the warning disappears, and going online continues by itself.
- The same popup appears automatically if you switch location off while already online.
- The banner button stays as a manual retry for anyone who taps "No thanks".

### 2. Buttons always do something

- A second, independent way of opening the phone's Location page and the app's permission page is added, so if one path is unavailable the other is used.
- The error message only appears when both paths fail, and it then tells you exactly where to go: Settings > Apps > badiyos Expert > Permissions > Location.
- Same behaviour for the "Open Settings" button in the red "Location access needed" card.

### 3. Repeat prompt instead of a dead end

- If permission was only denied once (not permanently), tapping "Tap to go online" asks for permission again instead of showing the blocked card.

## Technical details

- Add `capacitor-native-settings` as a fallback for `openLocationSettings` / `openSettings`: try the custom `BackgroundLocation` plugin first, then `NativeSettings.openAndroid({ option: AndroidSettings.Location | ApplicationDetails })`. Both wrapped in try/catch in `src/lib/background-location.ts`, returning a success flag.
- `promptEnableDeviceLocation()` gets called proactively from the go-online mutation and from the GPS watchdog in `src/routes/home.tsx`, not only from the banner button. On `enabled: true` the toggle flow resumes automatically; on `resolvable: false` it falls back to opening Location settings.
- New locale strings for the "go to Settings manually" instruction in `src/lib/locales/en.ts` and `mr.ts`.
- No backend, database or Edge Function changes.

## Important

These are native capabilities — they only take effect in a **newly built APK** that includes the current `android/` sources (package `com.badiyos.expert`) and the `com.google.android.gms:play-services-location:21.3.0` dependency listed in the manual-merge notes. Without that dependency the in-app popup cannot be shown and the app falls back to opening the Location settings page.
