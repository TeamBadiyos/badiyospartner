# Store Delivery inside the courier flow (Expert App)

## What the rider will see
1. **Offer card on Home** — same card, same sound, same Accept/Dismiss. Top label "Store Delivery" + store name (instead of "Parcel"). Pickup = store area, drop = customer area, km, earning.
2. **Step 1 – Go to store** — same navigation screen, shows store name, Order ID and item count (no prices, no customer phone).
3. **Step 2 – At store** — "Arrived", then enter the **merchant's pickup OTP**. Only after the server accepts it does the job move to "Picked up".
4. **Step 3 – Go to customer** — same drop navigation.
5. **Step 4 – At customer** — enter the **customer's delivery OTP** → Delivered → completion screen with earning.
6. **Cancel** — visible only before pickup, with the existing reason list; the order goes back to dispatch for other riders. After pickup, cancel is gone and only an **Emergency Support** button shows (opens SOS/support). The server also refuses cancel after pickup.
7. **Earnings** — same courier payout; shows in the single wallet list as a courier trip labelled with the store name.

## Current state (verified)
- `courier_orders` has no link to `merchant_orders` today; store orders are not yet dispatched as courier jobs.
- Courier flow already has pickup/delivery OTP, pre-pickup-only cancel and broadcast dispatch.

## Technical details
Backend (shared DB, one migration, no new tables):
- Add nullable `merchant_order_id uuid` (FK merchant_orders) and `source text default 'parcel'` (`'parcel' | 'store'`) to `courier_orders`.
- `courier_rider_offers()` returns `source`, `store_name`, `item_count`.
- Store pickup OTP: reuse `courier_issue_otp(order,'pickup')`; merchant sees it through the Merchant/Store app (that side is outside this project). `courier_verify_otp` unchanged.
- `courier_rider_cancel`: if status is DRIVER_ASSIGNED/ARRIVED_PICKUP → clear rider, back to SEARCHING, call `courier_dispatch_next`; else raise `cancel_not_allowed_after_pickup` (already partly enforced, confirm + tighten).
- On DELIVERED for store orders, mirror status to the linked `merchant_orders` row. Payout via existing `courier_settle_order`.
- Creating the courier order when a store order is ready is the Customer/Merchant App's job; this plan assumes they insert with `source='store'` + `merchant_order_id`.

Frontend:
- `src/lib/courier.ts`: extend types (`source`, `store_name`, `item_count`, `merchant_order_code`).
- `src/routes/home.tsx`: offer card label/store name.
- `src/routes/courier.$id.tsx`: store header block, merchant-OTP wording, Emergency Support button after pickup.
- `src/routes/wallet.tsx`: store name on courier rows.
- en/mr locale strings.
- No native change, no new APK.
