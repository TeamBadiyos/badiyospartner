# Courier (bike delivery) rider screens

Web part live jaayega, native part sirf likha jaayega (dormant, build nahi).

## Backend check (already verified)

Live RPCs ke naam thode alag hain — plan inhi ko use karega, koi nayi table nahi banegi:

| Kaam | Live RPC |
| --- | --- |
| Offer list | `courier_rider_offers()` |
| Accept / Reject | `courier_offer_respond(_offer_id, _accept)` |
| Arrived / In transit | `courier_rider_advance(_order_id, _to_status, _lat, _lng)` |
| Pickup + delivery OTP | `courier_verify_otp(_order_id, _purpose, _otp, _proof_url)` |
| Incident | `courier_report_incident(_order_id, _code, _notes)` |
| Cancel (pickup se pehle hi) | `courier_rider_cancel(_order_id, _reason)` |

Order flow: SEARCHING → DRIVER_ASSIGNED → ARRIVED_PICKUP → PICKED_UP → IN_TRANSIT → DELIVERED. Arrived tabhi chalega jab rider pickup ke 200 m ke andar ho (server khud check karta hai), isliye fresh GPS fix bhejna zaroori hai.

## Web screens

**1. Courier tab (`/courier`)**
- Tab sirf tab dikhega jab rider ka "Courier Delivery" skill approved ho (`partner_skills` + `service_categories`).
- Offer cards: pickup/drop area, trip km, parcel type, rider earning, aur `expires_at` se live countdown (jaise hi 0 ho card khud hat jaaye). Accept / Reject buttons. Server reply par saaf message: offer expired, already taken, already on a job.
- Offers 10 second polling + realtime refresh.

**2. Active job screen (`/courier/$id`)**
- Stage ke hisaab se ek hi primary action dikhega:
  - Assigned → Navigate (Google Maps link) + "Arrived at pickup" (fresh GPS fix ke saath; door hone par "pickup se door ho" message).
  - Arrived → 4-digit pickup OTP entry, galat OTP par bache hue attempts, 5 galat par 30 min lock ka message.
  - Picked up → "Start transit" + drop ka Navigate.
  - In transit → delivery OTP entry + optional proof photo; ya "Couldn't deliver" → reason list (consignee unreachable, wrong address, refused, damaged, accident) + notes + photo.
- Parcel uthne ke baad (PICKED_UP se aage) cancel button bilkul nahi dikhega; sirf assigned stage tak dikhega.
- Contact name, phone aur call button sirf assigned order par.

**3. Location rate**
- Active courier job (assigned se in-transit tak) ke dauraan foreground location har 15 second, job khatam hote hi wapas normal 30/60 second rate par.

**4. Battery & Autostart guide (`/battery-guide`)**
- Xiaomi/Redmi, Vivo, Oppo, Realme, Samsung ke step-by-step text (English + Marathi).
- "Open settings" button sirf tab dikhega jab native plugin available ho; warna sirf text steps.
- Profile se link.

**5. Earnings**
- Wallet/History me courier trips alag section/filter me, order code + route + payout ke saath.

## Native (dormant — sirf code aur docs, build nahi)

`native/android/` me likha jaayega aur `native/android/MANUAL_MERGE.md` me steps:
- `BackgroundLocationPlugin`: naya `setMode({ mode: "courier" | "normal" })` — courier par 15 s interval + PRIORITY_HIGH_ACCURACY, normal par purana behaviour.
- `BadiyoMessagingService` + `BookingRingActivity`: `type=courier_offer` ka alag rasta — `expires_at` ka countdown screen par, Accept par `courier_offer_respond`, timeout par apne aap band.
- Battery optimization aur OEM autostart ke intents (Xiaomi/Vivo/Oppo/Realme/Samsung), safe fallback ke saath.
- `ACTIVITY_RECOGNITION`, `SCHEDULE_EXACT_ALARM`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` permissions **nahi** joded jaayenge.

## Compatibility

Saare naye native calls feature-detected honge (`setMode` na mile to chup-chaap skip), taaki current published APK par web code bina toote chale.

## Naam badlav

App display name har jagah "badiyos Expert" (abhi `capacitor.config.ts` me "badiyos Partner" hai). Native rebuild ke baad hi phone par dikhega.

## Ek cheez confirm karni hai

Photo proof upload ke liye abhi koi courier storage bucket nahi hai. Plan ek private `courier-proofs` bucket banane ka hai (sirf rider apne assigned order ke liye upload kar sake) — koi nayi table nahi. Agar aap kisi maujooda bucket me daalna chahte ho to bata dena.
