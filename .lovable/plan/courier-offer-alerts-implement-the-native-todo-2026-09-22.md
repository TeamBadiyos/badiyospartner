# Courier offer alerts — implement the native TODO

Applies only to source files under `native/android/` (the dormant native template). Nothing here ships to the live website or the currently published APK; you copy these into `android/` when you build the next APK.

## 1. BadiyoMessagingService.java

- Add a `courier_offer` branch at the top of the data-message handling, before the existing `alert_type` ring whitelist: when `data.type == "courier_offer"`, build the ring intent with `alert_kind = "courier_offer"`, `offer_id`, `order_id`, `expires_at`, title from `order_code`, body as `pickup_area -> drop_area`, plus earning and trip km for display.
- Foreground behaviour stays the same as booking alerts: if the app is open, delegate to the web layer (Home already shows the offer card and plays its sound) so it never rings twice.
- Extract the existing notification-building code into a shared `startFullScreenAlert(Intent ring, String channelId, String title, String text, int timeoutSeconds, boolean withAcceptReject)` helper — the MANUAL_MERGE snippet calls this and it does not exist yet. The booking path keeps using it with `new_booking_alerts`; courier uses `courier_offer_alerts`.
- Courier notification: CATEGORY_CALL, PRIORITY_MAX, ongoing, full-screen intent, timeout equal to the seconds left until `expires_at`.
- New constant `COURIER_CHANNEL_ID = "courier_offer_alerts"` and a new `ALERT_KIND` extra key.

## 2. BookingRingActivity.java

- New extras: `alert_kind`, `offer_id`, `order_id`, `expires_at`, `earning`.
- New `courier` branch in `applyIntent()` alongside the extension / info / booking branches:
  - Title = order code, subtitle = pickup → drop, detail line = earning and trip distance.
  - Countdown derived from `expires_at` (ISO-8601 parsed with an offset-aware parser, falling back to the plain instant form), clamped to 0–120 seconds; 0 means finish immediately. Timer text reads "Expires in Ns"; at zero the ringtone stops and the screen closes.
  - **Accept** → stop ringing, cancel the notification, then off the main thread call `courier_offer_respond` with `{"_offer_id": …, "_accept": true}`. On `ok: true` deep-link the app to `/courier/<order_id>`; on `ok: false` show the returned reason as a toast (`offer_expired` → "Offer expired", `already_taken` → "Another rider took this order", `already_on_a_job` → "You already have an active delivery", `offer_unavailable` → "Offer no longer available") and finish. Network/auth failure shows "Could not accept — open the app" and finishes.
  - **Reject** → same RPC with `"_accept": false`, fire-and-forget on a background thread, finish immediately.
- Booking/extension/info branches are untouched, including the existing 60s / 20s timeouts.

## 3. MainActivity.java

Register the `courier_offer_alerts` channel next to `new_booking_alerts`: IMPORTANCE_HIGH, lockscreen-public, vibration on, same custom alert sound with ringtone audio attributes, created idempotently on Android O+.

## 4. MANUAL_MERGE.md

Move the courier section from "TODO at native build time" to "DONE in this folder", listing the three touched files and adding `courier_offer_alerts` to the channel table.

## Technical notes

- `SupabaseRpc.call(ctx, fn, params)` is blocking — every courier RPC runs on a short-lived background thread, with the UI result posted back through the main-thread handler.
- Reason strings match the backend exactly (`offer_unavailable`, `offer_expired`, `already_taken`, `already_on_a_job`).
- `alert_type` remains absent from the courier payload, so `isRingAlert()` stays false and the currently published APK keeps ignoring courier pushes.
- Java-only change; no web code, no migration, no publish.
