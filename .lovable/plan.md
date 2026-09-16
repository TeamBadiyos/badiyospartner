# App closes right after the logo screen — find and fix

You see the blue logo screen, then the app closes. Below is how we find the real cause and the two things that are most likely wrong today.

## Step 1: capture the actual crash

Without the phone's error report we would be guessing. Two easy ways:

- Plug the phone into a computer with Android Studio and open Logcat while reproducing the crash, or
- On the phone: Settings > About phone > tap "Build number" 7 times, then Developer options > "Bug report" right after the crash and share the file.

We need the lines that follow "FATAL EXCEPTION".

## Step 2: the two most likely causes (both checkable without the log)

### A. The app opens the wrong website address

The app shell is set to load `partner.badiyos.com`, but this Expert app is published at `expert.badiyos.com`. If that first address doesn't serve this app, the screen after the logo has nothing to show. Fix: point the app shell at `expert.badiyos.com` and rebuild.

### B. Missing Google location library in the Android build

The new "Turn on location" popup needs a Google library added to the Android project by hand. If the build was made without it, the app can die the moment the location code is touched. Fix: confirm the library line is present in the Android build file, or make the location code safe so a missing library shows a message instead of closing the app.

## What will change in this project

- Correct the app shell address to the one this app is actually published on.
- Make the location bridge fail softly: wrap the Google-location code path so that if the library is absent the app falls back to opening the phone's Location settings instead of crashing, and guard the startup screen's work so any error still lands on the login screen.
- Update the Android setup notes so the required library line and the correct address are unambiguous for the next build.

## Technical details

- `capacitor.config.ts`: `server.url` currently `https://partner.badiyos.com` with `allowNavigation` limited to that host; change both to the live Expert domain (`expert.badiyos.com`), keeping `errorPath: offline.html`.
- `BackgroundLocationPlugin.promptEnableLocation()` already wraps its body in `try/catch (Throwable)`, but the Play Services classes are resolved on method entry; add an explicit availability probe (`Class.forName`/`GoogleApiAvailability`) before touching `LocationServices`, returning `{ enabled:false, resolvable:false }` when absent. Mirror to `native/android/...`.
- `src/routes/index.tsx`: wrap navigation in a failure-safe path so an exception during session lookup still routes to `/login`.
- `native/android/MANUAL_MERGE.md` and `android/README.md`: restate `implementation "com.google.android.gms:play-services-location:21.3.0"` as mandatory and note the live URL.

A new APK build is required for any of this to take effect.
