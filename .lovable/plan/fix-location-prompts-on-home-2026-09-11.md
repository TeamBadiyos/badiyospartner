# Fix location prompts on Home

Two problems when the partner toggles availability:

1. The "Open Settings" button in the red location banner does nothing.
2. When permission is allowed but the phone's location (GPS) switch is off, the app only shows a banner — the partner has to leave the app to turn it on.

## What will change

### 1. Settings button always opens Settings

- The button currently calls the native bridge without catching failures, so if the call fails nothing happens and no message is shown. It will be awaited, and on any failure the partner sees a short message explaining what to do.
- If the app is opened in a normal browser (where no phone settings exist), the button shows a clear message instead of silently doing nothing.
- Same treatment for the "Open location settings" button in the GPS banner, with a fallback to the app's own settings page if the direct location page can't be opened.

### 2. Turn on location from inside the app

- Add a native "turn on location" prompt using Google's built-in location-settings dialog. Tapping the button shows the standard "Turn on location?" popup right inside the app; the partner taps "OK" and location switches on without leaving the app.
- If the phone can't show that popup (older device / no Google services), it falls back to opening the phone's Location settings page as it does today.
- After the popup is answered, the app re-checks location immediately: if it is now on, the red banner disappears and going online continues automatically instead of the partner having to tap the toggle again.
- The same re-check runs when the app comes back to the foreground, so returning from Settings also clears the banner.

## Technical details

- `android/app/src/main/java/com/badiyos/partner/BackgroundLocationPlugin.java` (and the mirror in `native/android/...`): new `@PluginMethod promptEnableLocation()` built on `SettingsClient.checkLocationSettings` with a `LocationSettingsRequest` (high accuracy) and `ResolvableApiException.startResolutionForResult`, resolved through an activity-result callback returning `{ enabled: boolean, resolvable: boolean }`. `openLocationSettings` / `openSettings` keep their existing intents; they already fall back to the app details page.
- Requires `com.google.android.gms:play-services-location` in `android/app/build.gradle` — noted in `native/android/MANUAL_MERGE.md` along with the new method, since the Android project is merged manually.
- `src/lib/background-location.ts`: add `promptEnableDeviceLocation()` wrapping the new method; make `openAppLocationSettings` / `openDeviceLocationSettings` return a boolean success flag instead of swallowing errors, so the UI can react.
- `src/routes/home.tsx`: banner buttons become async handlers that await the bridge, show a `sonner` toast on failure, and re-run the GPS check + resume the pending go-online flow on success. New locale strings added to `src/lib/locales/en.ts` and `mr.ts`.
- No backend, database, or Edge Function changes.

## Testing note

The native part only takes effect after rebuilding the Android app; the web preview will show the fallback message.
