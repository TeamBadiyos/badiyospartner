# Courier offer push — expert-send-push update

## Abhi kya hai (verified)

- `supabase/functions/expert-send-push/index.ts` sirf home-service bookings handle karta hai: `booking_id` + `expert_id` mandatory, title/body caller ki body se ya `bookings` table se, hamesha data-only push.
- Auth: `x-trigger-secret` header (env `PUSH_TRIGGER_SECRET`) **ya** service-role bearer. Koi public access nahi.
- Aaj DB me koi function `expert-send-push` ko call nahi karta — sab alerts `notify_push_event()` se pg_net ke zariye shared `send-push-notification` function par jaate hain (secret `edge_runtime_config.push_trigger_secret`, header `x-internal-secret`). Purane migrations me `expert-send-push` ka pg_net call tha, wo replace ho chuka hai.
- `courier_dispatch_next(_order_id)` pehle se hi offer insert karke `notify_push_event('expert', expert_id, ...)` maarta hai, data me `type=courier_offer, order_id, offer_id, expires_at, pickup_area, drop_area, trip_km, earning, push_mode` — koi phone number nahi.
- Flag `courier_native_alert_enabled` **`ops_settings`** me hai (value `0` = OFF), `dispatch_config` me nahi. `courier_setting()` se padha jaata hai.
- Web me abhi koi `PushNotifications.createChannel` call nahi hai.

## Kya banega

### 1. Edge function: courier branch
`expert-send-push` me `body.type === "courier_offer"` par naya raasta:
- Input sirf `offer_id` + `expert_id` (booking_id nahi).
- DB verify (service role): offer exist kare, `status='pending'`, `expires_at > now()`, aur `expert_id` match kare. Fail par `400 {error:"offer_not_pending"|"offer_expired"|"expert_mismatch"}`, koi push nahi.
- Title/body/payload **sirf DB se** (`courier_orders` + `courier_offers`), caller ki body se nahi: earning = base + extra − commission%, pickup/drop area = address ka pehla comma-segment, trip km = `distance_km`.
- Flag `courier_setting('courier_native_alert_enabled', 0)`:
  - **OFF (0):** `notification { title, body }` + data payload + `android.notification.channel_id = "courier_offers"`, priority HIGH, ttl = offer ke bache hue seconds.
  - **ON (1):** data-only, `android.priority = "HIGH"`, no notification block.
- Data payload (sab strings): `type=courier_offer, order_id, offer_id, expires_at, pickup_area, drop_area, trip_km, earning, route="/courier"`. `alert_type` field bheja hi nahi jaayega → published APK ka `isRingAlert` false → `BookingRingActivity` kabhi nahi khulegi.
- Koi phone number, consignee naam ya poora address payload me nahi.
- Token lookup, token pruning aur FCM auth ka existing code reuse hoga.

### 2. Trigger link (migration)
Home-service jaisa hi mechanism: pg_net POST. Nayi SECURITY DEFINER helper `notify_courier_offer_push(_offer_id uuid, _expert_id uuid)` jo `edge_runtime_config` se secret leke `/expert-send-push` par `{type:"courier_offer", offer_id, expert_id}` POST karegi (header `x-trigger-secret`), exception-safe. `courier_dispatch_next` me courier_offer wala `notify_push_event(...)` call isi helper se replace hoga (baaki logic same). Execute PUBLIC/anon/authenticated se revoke.

### 3. Web layer
- `src/lib/push.ts`: feature-detected `PushNotifications.createChannel({ id: "courier_offers", importance: 5, visibility: 1, sound/vibration on })` — sirf Android par, try/catch me (purane APK par crash nahi).
- Notification tap: `routeFromData` me `data.type === "courier_offer"` → `data.route` (`/courier`) par navigate. Foreground me courier_offer par booking-wala toast/alert-sound flow nahi chalega.
- `src/routes/courier.tsx`: expire ho chuke offers par "Offer expire ho gaya" message (en + mr string), Accept button disabled; `courier_offer_respond` se expired error aaye to bhi yahi dikhega.

## Notes

- Ye DB shared hai (customer app bhi isi par hai). `courier_dispatch_next` me courier push ka raasta badlega — baaki alerts jaise the waise rahenge.
- Koi nayi table nahi, koi nayi permission nahi, native code dormant hi rahega.

## Test steps (kaam ke baad)

1. `ops_settings.courier_native_alert_enabled = 0` rakho. Ek test courier order `SEARCHING` me daalo, `select courier_dispatch_next('<order_id>')`.
2. Edge logs (`expert-send-push`) me `courier_offer sent=N` dikhna chahiye; phone par normal heads-up notification "New courier delivery" — koi full-screen ring nahi.
3. Notification tap → app `/courier` par khule, offer card countdown ke saath.
4. Offer expire hone do (30s) → card par "Offer expire ho gaya", Accept disabled.
5. Expired offer_id se function ko manually call karo → `400 offer_expired`, koi push nahi.
6. Dusre expert ka offer_id + galat expert_id → `400 expert_mismatch`.
7. Flag `1` karke repeat → push data-only jaayega (purane APK par silent; naya native APK build hone par hi ring aayega).
