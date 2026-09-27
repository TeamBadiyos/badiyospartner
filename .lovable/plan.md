# Parcel scanning on business trips

## What changes (business trips only)
- **Pickup stop:** after "I have arrived", a **Scan parcels** step appears before the OTP. The rider scans each parcel's QR label with the phone camera and sees a live counter "8 / 10 scanned". Each scan shows a message:
  - green: scanned (with the parcel's drop label, e.g. "C3 · 1 of 2")
  - red: "This parcel belongs to another trip", "Already scanned", "Not a badiyos label"
- A **Type code** button lets the rider type the printed code when the camera cannot read a label.
- The OTP box stays locked until every parcel on the trip has been scanned.
- **Each drop stop:** "Scan C3 parcels (0/2)" before the OTP, using the same scanner. A parcel for another drop shows "This parcel is for C5". The OTP unlocks when all of that drop's parcels are scanned.
- If support skipped scanning for a stop, the rider sees "Scan skipped by support" and can enter the OTP right away.
- If the OTP check reports that parcels are still unscanned, the app reopens the scan step.
- Regular customer courier orders and store deliveries stay exactly as they are today. Return stops have no scanning.
- English and Marathi text for everything new.

## Android camera setup for the next app build
1. Add to `AndroidManifest.xml`: `<uses-permission android:name="android.permission.CAMERA" />` and `<uses-feature android:name="android.hardware.camera" android:required="false" />`.
2. In `MainActivity`, let the in-app browser grant camera access when the app asks for it (a WebChromeClient `onPermissionRequest` that grants `RESOURCE_VIDEO_CAPTURE` once the Android camera permission is granted, and asks for the Android permission if missing). Exact code goes in both native copies and the manual-merge notes.
3. Play Console: declare camera use (scanning parcel labels) in the Data safety / permissions section.
4. Until that build is installed, the camera may be refused in the current app, so the "Type code" option always works as a fallback.

## Technical details
- Backend already exists (verified): `courier_scan_packet(_courier_order_id, _code, _stage, _stop_id)` returns `{result, ok, scanned, total, packet_no, drop_label}` with results ok / unknown / wrong_trip / wrong_stop / already_scanned; `courier_trip_packets(_courier_order_id)` returns packets with `drop_stop_id`, `drop_label`, `packet_no`, `packet_total`, `scanned_pickup_at`, `scanned_drop_at`; `courier_verify_stop_otp` returns `packets_not_scanned` for business orders unless `courier_order_stops.scan_skipped_at` is set. No database changes.
- `src/lib/courier.ts`: add `scan_skipped_at` to the stops select, a `useCourierTripPackets(orderId, enabled)` query (enabled only when `source = 'business'`) and a `scanPacket()` helper.
- New `src/components/packet-scanner.tsx`: camera QR scanner using a pure-JS library (`@zxing/browser`, rear camera, loaded only in the browser), debounced so one label is not sent twice in a row, short beep/haptic feedback on ok/error, plus the Type code input. Stops the camera when closed.
- `src/routes/courier.$id.tsx`: for business orders on an arrived pickup/drop stop, compute scanned/total from trip packets (whole trip for pickup, that drop's packets for drop); show the scan step and keep the OTP disabled until complete or `scan_skipped_at` is set; on `packets_not_scanned` from verify, refetch packets and open the scanner. Non-business paths untouched.
- Camera permission denied or unavailable shows a friendly message and opens Type code.
- Verify at mobile width with a regular courier job (unchanged) and the business scan UI with mocked data, since no live business trips exist yet.
