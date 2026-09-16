# Fix: App crash on launch — Firebase not initialized (com.badiyos.expert)

## Root cause

The installed APK reports package `com.badiyos.expert` and crashes on open with:

```text
IllegalStateException: Default FirebaseApp is not initialized in this process com.badiyos.expert
  at com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin.register(...)
```

The app calls push registration on startup (Home screen), but the Android build has **no working Firebase configuration**: there is no `google-services.json` in `android/app/`, so Firebase never initializes and the first `PushNotifications.register()` call kills the whole app. The package name mismatch made this worse: our files said `com.badiyos.partner`, while the shipped APK and (presumably) the Firebase project use `com.badiyos.expert`.

Decided: **canonical package is `com.badiyos.expert` everywhere.**

## Changes

### 1. Align package name to com.badiyos.expert
- `capacitor.config.ts`: `appId: "com.badiyos.expert"`.
- Rename Java package directories `com/badiyos/partner/` → `com/badiyos/expert/` in both `android/app/src/main/java/...` and `native/android/...`, updating the `package` line and all `com.badiyos.partner.*` action/intent strings in every Java file (MainActivity, BackgroundAvailabilityService, BackgroundLocationPlugin, BadiyoMessagingService, BookingRingActivity, BookingAlertActions, SupabaseRpc).
- Update `native/android/MANUAL_MERGE.md`: applicationId `com.badiyos.expert`, all file mappings, action strings.

### 2. Crash-proof push registration (works even without Firebase)
Since the exception is thrown inside the Capacitor plugin thread, a JS try/catch cannot prevent the crash. Add a native guard:
- `BackgroundLocationPlugin` (or a small new `FirebaseGuardPlugin`): expose `isFirebaseAvailable()` — returns true only if `FirebaseApp.getApps(context)` is non-empty (reflection-free, guarded by try/catch so a missing Firebase library also returns false).
- `src/lib/push.ts`: before `PushNotifications.register()` or adding listeners, call `isFirebaseAvailable()`; if false, log a clear warning and skip push init — the app continues normally without push.
- Also wrap the JS registration flow in try/catch for any other rejection.

Result: the app can never crash from missing Firebase config again — it just runs with push disabled.

### 3. Enable real push notifications (requires one user action)
Push will only actually work once Firebase is configured:
- **User step (cannot be done by us):** in the Firebase console, ensure an Android app exists for `com.badiyos.expert` with the release/debug SHA-1 added, download the generated `google-services.json`, and place it at `android/app/google-services.json`. (If a Firebase app exists for the Customer app project, add the Expert package as a new Android app in the same or a new Firebase project — backend already sends via FCM HTTP v1, so any project works as long as its service account is what the server uses.)
- `MANUAL_MERGE.md`: document the exact steps — file location, applying the `com.google.gms.google-services` plugin in `android/app/build.gradle` and the classpath in `android/build.gradle`, and verifying the package inside `google-services.json` matches `com.badiyos.expert`.

### 4. Verify
- `bunx tsgo --noEmit` passes.
- Grep: no remaining `com.badiyos.partner` references anywhere in `android/`, `native/`, or config.
- User rebuilds the APK: app opens without crash (with or without google-services.json); with google-services.json in place, push registration succeeds and a test notification arrives.

## Out of scope
- No backend/Supabase changes — the server-side FCM send path is unchanged.
