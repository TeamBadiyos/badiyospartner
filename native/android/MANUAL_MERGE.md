# Partner App — Native Android manual merge guide

Hand-authored native sources for two features that are **not** produced by
`npx cap add android`:

1. **Background location foreground service** — keeps reporting the expert's
   location to Supabase (`expert_update_location`) while they are online, even
   when the app is backgrounded or swiped away.
2. **Full-screen incoming-job alarm** — an incoming-call-style, lock-screen
   alert triggered by a data-only FCM push, with Accept / Reject wired to the
   same `claim_booking_as_expert` RPC the in-app modal uses.

The `android/` folder is generated (not committed), so after running
`npx cap add android` copy these files in and apply the manifest merges below.

---

## 1. File copy table

| Source (this repo)                                                              | Destination (generated `android/` project)                                |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `native/android/app/src/main/java/com/badiyos/expert/MainActivity.java`          | `android/app/src/main/java/com/badiyos/expert/MainActivity.java` (replace) |
| `native/android/app/src/main/java/com/badiyos/expert/SupabaseRpc.java`           | same path under `android/`                                                  |
| `native/android/app/src/main/java/com/badiyos/expert/BackgroundAvailabilityService.java` | same path under `android/`                                          |
| `native/android/app/src/main/java/com/badiyos/expert/BackgroundLocationPlugin.java` | same path under `android/`                                              |
| `native/android/app/src/main/java/com/badiyos/expert/BadiyoMessagingService.java` | same path under `android/`                                                |
| `native/android/app/src/main/java/com/badiyos/expert/BookingRingActivity.java`   | same path under `android/`                                                  |
| `native/android/app/src/main/java/com/badiyos/expert/BookingAlertActions.java`   | same path under `android/`                                                  |
| `native/android/app/src/main/res/layout/activity_booking_ring.xml`                | `android/app/src/main/res/layout/activity_booking_ring.xml`                 |

`applicationId` / package must be `com.badiyos.expert` (matches
`capacitor.config.ts`). If the package ever changes, update the `package`
line in every Java file and all `com.badiyos.expert.action.*` action strings.

### Gradle — automated, do NOT add by hand

These dependencies now live in the tracked file
`android/app/badiyo-native.gradle`:

```gradle
implementation "com.google.android.gms:play-services-location:21.3.0"
// ^ required by BackgroundLocationPlugin.promptEnableLocation(), which shows
//   Google's in-app "Turn on location?" dialog (SettingsClient +
//   ResolvableApiException.startResolutionForResult, requestCode 4711).
implementation platform("com.google.firebase:firebase-bom:33.7.0")
implementation "com.google.firebase:firebase-messaging"
```

Run `bun run sync:android` (instead of `npx cap sync android`) — it wires
`apply from: "badiyo-native.gradle"` into `android/app/build.gradle`
automatically and is idempotent.

Also required for push to work: `google-services.json` at `android/app/`, the
`com.google.gms.google-services` plugin applied in `android/app/build.gradle`,
and its classpath in `android/build.gradle`. `@capacitor/push-notifications`
must be installed (it provides `MessagingService`, which
`BadiyoMessagingService` extends so JS token registration keeps working).

#### google-services.json (exact steps)

1. Firebase console → project → Project settings → Your apps → add/open the
   Android app with package name **`com.badiyos.expert`** (must match
   `applicationId` exactly, or Firebase stays uninitialized and push is dead).
2. Add the debug and release SHA-1 signing fingerprints.
3. Download `google-services.json`, place it at `android/app/google-services.json`.
4. Verify the file contains `"package_name": "com.badiyos.expert"`.
5. `android/build.gradle`: `classpath "com.google.gms:google-services:4.4.2"`.
6. `android/app/build.gradle` (top or bottom): `apply plugin: "com.google.gms.google-services"`.

**Without this file the app must NOT crash:** `BackgroundLocationPlugin.isFirebaseAvailable()`
returns `available: false` (reflection-based, safe even when Firebase classes are
absent) and `src/lib/push.ts` skips push registration entirely. Historically,
calling `PushNotifications.register()` with no default FirebaseApp threw
`IllegalStateException: Default FirebaseApp is not initialized` on the
Capacitor plugin thread — uncatchable from JS, killing the app at startup.

---

## 2. AndroidManifest.xml merge blocks

### 2a. Permissions — above `<application>`

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<!-- Android 10+: "Allow all the time"; must be requested separately, after
     foreground location is already granted. -->
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
<uses-permission android:name="android.permission.TURN_SCREEN_ON" />
<uses-permission android:name="android.permission.DISABLE_KEYGUARD" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

### 2b. Inside `<application>` — background location service

```xml
<service
    android:name=".BackgroundAvailabilityService"
    android:exported="false"
    android:foregroundServiceType="location"
    android:stopWithTask="false" />
```

### 2c. Inside `<application>` — FCM messaging service

Declared **before** any Capacitor push service entry so it wins the intent
filter; it extends the plugin's `MessagingService` and delegates everything
that isn't a ring alert.

```xml
<service
    android:name=".BadiyoMessagingService"
    android:exported="false"
    android:directBootAware="true">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>

<meta-data
    android:name="com.google.firebase.messaging.default_notification_channel_id"
    android:value="new_booking_alerts" />
```

### 2d. Inside `<application>` — full-screen alarm activity + action receiver

```xml
<activity
    android:name=".BookingRingActivity"
    android:exported="false"
    android:launchMode="singleTask"
    android:excludeFromRecents="true"
    android:showOnLockScreen="true"
    android:turnScreenOn="true"
    android:showWhenLocked="true"
    android:screenOrientation="portrait"
    android:taskAffinity=".BookingRing"
    android:theme="@style/Theme.AppCompat.NoActionBar" />

<receiver
    android:name=".BookingAlertActions"
    android:exported="false" />
```

### 2e. Notification channels

Both channels are created in code (`MainActivity.ensureChannels()` and
`BackgroundAvailabilityService.ensureStatusChannel()`):

| Channel id             | Importance | Purpose                                             |
| ---------------------- | ---------- | --------------------------------------------------- |
| `new_booking_alerts`   | HIGH       | Ringing full-screen job alerts (sound + vibration)   |
| `courier_offer_alerts` | HIGH       | Ringing full-screen parcel (courier) offer alerts    |
| `expert_online_status` | LOW        | Silent ongoing "You're online" foreground-service ux |


---

## 3. Backend payload contract (data-only FCM)

`supabase/functions/expert-send-push` **already sends the exact shape below —
no backend changes are required.** Keep it data-only (no `notification`
block), or Android will post its own heads-up and suppress the full-screen
intent when the app is killed.

```jsonc
{
  "message": {
    "token": "<device fcm_token>",
    "data": {
      "type": "new_booking_broadcast" | "booking_assigned",
      "alert_type": "broadcast" | "assigned" | "extension_request"
                  | "order_cancelled" | "order_completed" | "reminder_10min",
      "booking_id": "<uuid>",
      "expert_id": "<uuid>",
      "title": "New booking nearby",
      "body": "2 hr · Sawe Wadi, Latur",
      "address": "<full address>",
      "area": "<area/locality>",
      "duration": "2 hr",
      "slot": "10:00-12:00",
      "lat": "18.40", "lng": "76.57",
      "timeout_seconds": "60",          // auto-dismiss window
      "route": "home" | "/booking/<id>",
      // optional, extension_request only:
      "extension_id": "<uuid>", "extra_minutes": "30", "extra_price": "…",
      // optional: remote alert sound, streamed by BookingRingActivity
      "sound_url": "https://…/alert.mp3"
    },
    "android": { "priority": "HIGH", "ttl": "60s", "direct_boot_ok": true }
  }
}
```

All FCM data values must be strings. `timeout_seconds` is read from
`dispatch_config.radius_expand_after_seconds`, so the phone stops ringing
exactly when the booking stops being broadcast-eligible to this expert
(defaults to 60s; 30–45s also fine).

---

## 4. Behaviour notes

### Background location service

- Promotes to foreground within ~5s on **every** `onStartCommand` (Android 8+
  contract) before any early return, then refuses to keep running if
  `ACCESS_BACKGROUND_LOCATION` is missing on Android 10+.
- Polls `FusedLocationProviderClient.getCurrentLocation` with
  `PRIORITY_BALANCED_POWER_ACCURACY` every **60 s**, matching prior behaviour,
  and POSTs `p_lat` / `p_lng` to
  `POST /rest/v1/rpc/expert_update_location`.
- Auth: reads the Supabase session JSON from Capacitor Preferences
  (`SharedPreferences` file `CapacitorStorage`, key
  `sb-<project-ref>-auth-token`) and sends `access_token` as the bearer, so
  the SECURITY DEFINER RPC runs as the signed-in expert. **No service-role
  key ever lives on the device.**
- Notification: ongoing, `IMPORTANCE_LOW`, silent — "badiyos Expert — Online /
  You're receiving nearby job alerts". Tapping opens the app.
- `START_STICKY` + `stopWithTask="false"` so it survives task swipe; stopped
  via `ACTION_STOP`.

### Permission flow (Play-review safe)

`BackgroundLocationPlugin` exposes `check()`, `request()`, `openSettings()`,
`startBackgroundService()`, `stopBackgroundService()` to the web layer via
`src/lib/background-location.ts`. Two-step, as Android requires:

1. Foreground `ACCESS_FINE_LOCATION` first (Capacitor Geolocation).
2. Then background: on Android 11+ the system dialog cannot be shown, so
   `request()` returns `{granted:false, reason:"must_open_settings"}` and the
   UI must deep-link to app settings and instruct "Allow all the time".

Always show the rationale before asking: *"badiyos Partner uses your location
in the background only while you are online, to send you nearby job requests
and let customers track your arrival. Turn yourself offline and tracking
stops."* Use the same wording in the Play Console background-location
declaration.

### Full-screen job alarm

- `BadiyoMessagingService` handles data-only pushes whose `alert_type` is a
  ring type. If the app is in the **foreground**, it delegates to `super`
  (webview) so the in-app broadcast card / looping sound is not doubled.
- Otherwise it posts a `CATEGORY_CALL`, ongoing, `FLAG_INSISTENT`,
  `PRIORITY_MAX` notification with a full-screen intent to
  `BookingRingActivity`, plus Accept/Reject (or Accept/Decline, or OK for
  informational alerts) action buttons; on locked devices it also starts the
  activity directly.
- `BookingRingActivity` shows over the lockscreen, turns the screen on, loops
  the ringtone (or `sound_url`) with vibration, renders duration / address /
  job summary, counts down, and auto-dismisses at `timeout_seconds`.
- Accept → `BookingAlertActions` calls `claim_booking_as_expert` through
  `SupabaseRpc` (same RPC as the in-app modal), cancels the alarm and opens
  the app at the booking. Reject → local dismiss only, matching the in-app
  "Dismiss" behaviour; dispatch expands the radius on its own timer.
- Deep links follow existing routing: `route = "home"` for broadcasts (expert
  isn't assigned yet, so a booking-detail route would 403) and
  `/booking/<id>` for assigned jobs — identical to `src/lib/push.ts`.

---

## 5. Web-layer status

No web changes are needed in this pass; the hooks already exist:

- `src/routes/home.tsx` calls `startBackgroundAvailabilityService()` after a
  successful `expert_set_online(true)` and `stopBackgroundAvailabilityService()`
  when going offline. Add the same stop-call to the logout path if a future
  change lets an expert log out while still online.
- `src/lib/push.ts` registers the FCM token (`register_device_token`) and
  routes taps; `expert-send-push` sends the data-only payload above.

---

## Live URL (critical — wrong host = app closes after splash)

`capacitor.config.ts` `server.url` MUST be a live, published host for this
project: `https://expert.badiyos.com` (fallback `badiyosexpert.lovable.app`).
The old `partner.badiyos.com` host no longer resolves; an APK built with it
shows the logo and then dies. `bun run check:capacitor` enforces this.

Play Services location is required for the in-app dialog and is supplied by
`android/app/badiyo-native.gradle` via `bun run sync:android`. Without it the
in-app "Turn on location?" dialog is simply skipped (the plugin probes for the
classes first and falls back to opening the Location settings page) — it no
longer crashes.

---

# MANUAL MERGE BLOCK — settings fallback plugin

`capacitor-native-settings` is now a JS dependency and is used as a fallback
when the custom `BackgroundLocation` plugin is missing from the build (its
`openLocationSettings` / `openSettings` methods). Run `bun run sync:android`
after pulling so the plugin is auto-registered in `capacitor.settings.gradle`
and `MainActivity`'s plugin list — no manual Java edit is required.

Play Services location (mandatory for the in-app "Turn on location?" popup) is
applied automatically from `android/app/badiyo-native.gradle` by the same
command.

---

## MANUAL MERGE BLOCK — Courier (bike delivery), dormant

These changes live only in `native/android/` and are NOT in the currently
published APK. The web layer feature-detects every bridge below, so the
published APK keeps working untouched.

### (a) Courier location mode — DONE in this folder

- `BackgroundAvailabilityService.java`: `COURIER_INTERVAL_MS = 15_000L`,
  `setCourierMode(Context, boolean)`, `ACTION_RETUNE`, and
  `Priority.PRIORITY_HIGH_ACCURACY` while courier mode is on.
- `BackgroundLocationPlugin.java`: `setMode({ mode: "courier" | "normal" })`.
- Web caller: `setNativeLocationMode()` in `src/lib/background-location.ts`,
  used by `useCourierLocationPing()` in `src/lib/courier.ts` (15s foreground
  ping while a delivery is active, reverts to "normal" when it ends).
- No new permissions. Do NOT add `ACTIVITY_RECOGNITION`,
  `SCHEDULE_EXACT_ALARM`, or `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.

### (b) Courier offer alerts — DONE in this folder

Implemented across three files; just copy them into `android/` at build time.

`BadiyoMessagingService.java`
- Handles `data.type == "courier_offer"` before the `alert_type` ring
  whitelist: builds the ring intent with `alert_kind="courier_offer"`,
  `offer_id`, `order_id`, `expires_at`, `earning`, `trip_km`, title from
  `order_code` and body `pickup_area -> drop_area`.
- Skipped (delegated to the webview) while the app is in the foreground, and
  skipped entirely when `expires_at` has already passed.
- Notification building is now shared via `startFullScreenAlert(...)`:
  CATEGORY_CALL, PRIORITY_MAX, ongoing, INSISTENT, full-screen intent, timeout
  equal to the seconds left. Booking alerts use `new_booking_alerts`, courier
  offers use `courier_offer_alerts`.

`BookingRingActivity.java`
- New extras `alert_kind`, `offer_id`, `order_id`, `expires_at`, `earning`.
- `secondsUntil(expires_at)` parses ISO-8601 (with or without offset,
  fractional seconds stripped) and clamps to 0..120s; 0 closes the screen.
- Accept → `courier_offer_respond {_offer_id, _accept:true}` on a background
  thread; `ok:true` deep-links to `/courier/<order_id>`, `ok:false` toasts the
  mapped reason (`offer_expired`, `already_taken`, `already_on_a_job`,
  `offer_unavailable`) and finishes.
- Reject → same RPC with `_accept:false`, fire-and-forget, finishes at once.
- Booking / extension / info branches and their 60s / 20s timeouts unchanged.

`MainActivity.java`
- Creates the `courier_offer_alerts` channel (IMPORTANCE_HIGH, ringtone audio
  attributes, vibration, lockscreen-public) alongside `new_booking_alerts`.

Note: the courier payload deliberately carries no `alert_type`, so
`isRingAlert()` stays false and older APKs ignore courier pushes.


### (c) Battery / OEM autostart intents — DONE in this folder

`BackgroundLocationPlugin.java` adds `hasOemSettings()`, `openBatterySettings()`
and `openAutostartSettings()` (Xiaomi/MIUI, Oppo/ColorOS, Vivo/iQOO, Samsung,
Huawei component intents, each `resolveActivity`-checked with an app-info
fallback). The battery page opens `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`
— view only, no exemption is requested, so no permission is needed.

Web screen: `/battery-guide` (`src/routes/battery-guide.tsx`). The buttons only
render when `hasNativeOemSettings()` is true; otherwise riders see the written
Xiaomi / Vivo / Oppo / Realme / Samsung steps only.
