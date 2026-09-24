# Align Store Delivery with the live backend

## What the live database shows
- The backend (`store_create_courier_job`, called when the merchant accepts) creates the courier job with **`courier_orders.store_order_id = merchant_orders.id`**. It does not set `merchant_order_id`, and it leaves `source` at its default of `'parcel'`.
- The backend's `store_sync_from_courier` trigger reads `store_order_id` and updates the store order status (expert assigned, picked up, delivered).
- My earlier work uses **`merchant_order_id` + `source = 'store'`** to find store jobs. Real store jobs have neither, so right now riders would see them as plain parcels: no "Store Delivery" label, no store name or item count, and no store header.

## Changes
1. **Database (one migration, functions only, nothing dropped)**
   - `courier_rider_offers()`: set `source` to `'store'` when `store_order_id` is not null (otherwise keep the existing value), and read the store name and item count through `store_order_id`.
   - `courier_store_info(_order_id)`: look up the store order through `store_order_id` instead of `merchant_order_id`. The rider check stays the same.
2. **App**
   - `src/lib/courier.ts`: add `store_order_id` to the columns the order screen loads.
   - `src/routes/courier.$id.tsx`: `isStore = !!order.store_order_id` (instead of `source === "store"`).
   - `src/routes/home.tsx`: the offer card keeps using `o.source === "store"`, which is now correct because the offers function works it out.
3. OTPs stay on the existing `courier_verify_otp` path (pickup/delivery), so nothing changes there. Cancel after pickup stays blocked on the server.

## Now unused (kept for now, not dropped)
- Column `courier_orders.merchant_order_id`, plus its foreign key `courier_orders_merchant_order_id_fkey` and index `courier_orders_merchant_order_idx`.
- Column `courier_orders.source` as a store flag (no one sets it to `'store'`).
- Trigger function `courier_mirror_store_status()` and its trigger. It only acts on `merchant_order_id`, so it never fires now. The backend's `store_sync_from_courier` does this job.

## Check
- Look at a real store job (or a test row with `store_order_id` set). The offer card should show "Store Delivery · store · n items", and the delivery screen should show the store header, the pickup OTP step and Emergency Support after pickup.
- No new APK needed.
