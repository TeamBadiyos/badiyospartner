# Disable the unused store-status mirror trigger

## What the live database shows
- `courier_mirror_store_status` (trigger `courier_mirror_store_status` on `courier_orders`, currently enabled) was added by the Expert App. It acts only when `merchant_order_id` is set, and then sets `merchant_orders.status = 'completed'`. The backend never sets that column, so this trigger has no effect today.
- `courier_orders_sync_merchant_order` (trigger `trg_courier_orders_sync_merchant`, enabled) also relies on **`merchant_order_id`**, not `store_order_id`. It copies `courier_order_id` and `picked_up_at` onto the store order. Because the column is never set, this trigger also does nothing for real store jobs. The backend covers the same work: `store_create_courier_job` sets `courier_order_id`, and `store_sync_from_courier` (trigger `trg_store_sync_from_courier`, reads `store_order_id`) handles status and pickup.

## Change
- One migration: `ALTER TABLE public.courier_orders DISABLE TRIGGER courier_mirror_store_status;`
- No drops. The function and the trigger stay in place, so the change can be undone with `ENABLE TRIGGER`.
- `trg_courier_orders_sync_merchant` is left as it is. It was not added by this Expert App work, and you didn't ask for it to be disabled. It is reported as unused (it depends on `merchant_order_id`), and I can disable it too if you want.

## Check
- Query `pg_trigger` afterwards and confirm `courier_mirror_store_status` shows as disabled (`tgenabled = 'D'`) and `trg_store_sync_from_courier` is still enabled.
