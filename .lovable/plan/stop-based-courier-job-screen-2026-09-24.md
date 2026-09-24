# Stop-based courier job screen

## What the rider will see
- **Header:** "Stop X of N" progress bar + order code.
- **Current stop card** (first stop that is pending/arrived): Pickup / Drop / Return badge, address, contact + Call, Navigate, and parcel line ("Collect 2 parcels · for Drop 1", "Deliver 1 parcel · from Pickup 1", "Return 1 parcel to sender").
- **Upcoming stops** (collapsed, status chips) and completed stops greyed out.
- **Per stop:** "I have arrived" (fresh GPS) → 4-digit OTP + Verify (proof photo optional on drops only). No more "Start trip" step — after the last pickup the next stop simply appears.
- **Could not complete this stop:** shown on an arrived pickup/drop, locked with "Available in mm:ss" until the wait time passes; reason list per stop type, notes required for Other; pickup confirm warning about no refund.
- **Return stop:** after all drops; while its charge is unpaid shows "Waiting for customer to pay return charge ₹X", OTP locked, Call customer, "Support has been informed" when flagged. Unlocks once paid (checks every 10s).
- **Report incident** limited to Damaged parcel and Accident; SOS unchanged.
- **"I can't do this job"** (cancel) only until any pickup is completed.
- **Home offer card:** "N pickups · M drops" for multi-stop orders.
- **Completion:** earnings as today + return-charge earnings line; special message when cancelled with ALL_PICKUPS_FAILED.
- A normal 1 pickup + 1 drop order feels the same as today, minus Start trip. Store banner, merchant OTP hint, location ping, wallet credit unchanged.

## Verified backend
- RPCs exist: `courier_rider_arrive_stop(_stop_id,_lat,_lng,_accuracy_m,_fix_at)`, `courier_verify_stop_otp(_stop_id,_otp,_proof_url)`, `courier_rider_fail_stop(_stop_id,_reason_code,_notes,_return_distances)`, `courier_setting(_key,_default)`.
- Tables: `courier_order_stops` (stop_type, sequence, status, arrived_at, lat/lng, contact), `courier_order_parcels` (pickup/drop/return_stop_id), `courier_order_charges` (parcel_id, total_amount, status).

## Needs from you
- Secret **GOOGLE_MAPS_SERVER_KEY** (Google Routes API, server-only). I will ask for it before building the return-distance function; without it the fallback (straight-line × 1.3) is used.

## Technical details
- `src/lib/courier.ts`: types + hooks `useCourierStops`, `useCourierParcels`, `useCourierCharges` (select by order_id, sequence order); refetch after every action, 10s poll while a return charge is pending; fail wait from `courier_setting('courier_fail_wait_minutes',10)` via RPC (fallback 10).
- `src/lib/courier-returns.functions.ts`: `computeReturnDistances({order_id, failing_stop_id})` with `requireSupabaseAuth`; verifies caller is the assigned rider; Routes API `computeRoutes` from last drop → first returning pickup → next returning pickup; haversine × 1.3 fallback with log; returns `{ [pickup_stop_id]: km }`. Confirm bearer attacher in `src/start.ts`.
- `src/routes/courier.$id.tsx`: rewrite rendering driven only by order status + stop statuses; map RPC errors (wrong_otp with attempts left, locked, expired, payment_pending, server text like "Complete the earlier stop first").
- `courier_rider_offers()`: if it lacks `pickup_count`/`drop_count`, one migration adding only those two fields (counted from `courier_order_stops`). `home.tsx` shows them when >1.
- en/mr locale strings for all new texts.
- No native change, no new APK.
