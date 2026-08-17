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
| `native/android/app/src/main/java/com/badiyos/partner/MainActivity.java`          | `android/app/src/main/java/com/badiyos/partner/MainActivity.java` (replace) |
| `native/android/app/src/main/java/com/badiyos/partner/SupabaseRpc.java`           | same path under `android/`                                                  |
| `native/android/app/src/main/java/com/badiyos/partner/BackgroundAvailabilityService.java` | same path under `android/`                                          |
| `native/android/app/src/main/java/com/badiyos/partner/BackgroundLocationPlugin.java` | same path under `android/`                                              |
| `native/android/app/src/main/java/com/badiyos/partner/BadiyoMessagingService.java` | same path under `android/`                                                |
| `native/android/app/src/main/java/com/badiyos/partner/BookingRingActivity.java`   | same path under `android/`                                                  |
| `native/android/app/src/main/java/com/badiyos/partner/BookingAlertActions.java`   | same path under `android/`                                                  |
| `native/android/app/src/main/res/layout/activity_booking_ring.xml`                | `android/app/src/main/res/layout/activity_booking_ring.xml`                 |

`applicationId` / package must be `com.badiyos.partner` (matches
`capacitor.config.ts`). If the package ever changes, update the `package`
line in every Java file and all `com.badiyos.partner.action.*` action strings.

### Gradle

`android/app/build.gradle` — dependencies:

```gradle
implementation "com.google.android.gms:play-services-location:21.3.0"
implementation platform("com.google.firebase:firebase-bom:33.7.0")
implementation "com.google.firebase:firebase-messaging"
```

Also required: `google-services.json` at `android/app/`, the
`com.google.gms.google-services` plugin applied in `android/app/build.gradle`,
and its classpath in `android/build.gradle`. `@capacitor/push-notifications`
must be installed (it provides `MessagingService`, which
`BadiyoMessagingService` extends so JS token registration keeps working).

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
