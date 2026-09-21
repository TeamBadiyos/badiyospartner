# Service Hours — Expert App Plan

Timings city + category dono ke hisaab se office/admin set karega. Expert sirf dekhega.

## 1. Kaam ke ghante kahan store honge

Do nayi tables:

- **Service hours** — har city + service category ke liye, har weekday ka khulne aur band hone ka time, aur "us din band hai" flag. Category khaali chhodne par wo city ki default timing ban jayegi.
- **Holidays / band din** — tarikh, city, category (optional), aur wajah (jaise "Diwali"). Poora din band ya aadha din (alag open/close) dono support honge.

Ek chhoti setting: **courier last-order buffer** (default 30 minute) — close time se itna pehle naye parcel offer band.

## 2. Close time par apne aap offline

- Har 5 minute par chalne wala background check dekhta hai kaun se expert online hain aur unki city/category ab band ho chuki hai.
- **Job chal raha ho** (assigned / in progress / parcel picked up) → expert turant offline nahi hoga. Uspar "band hone ke baad offline" ka nishaan lag jayega, aur job complete hote hi wo apne aap offline ho jayega.
- **Koi job na ho** → turant offline, ek soft notification: "Service band ho gayi, aap offline kar diye gaye hain."
- Close ke baad naya offer bilkul nahi: home-service broadcast aur claim dono jagah, aur courier ke eligible-rider list me bhi, band waqt wale expert nikal diye jayenge. Yani expert galti se online reh bhi jaye to bhi offer nahi jayega.
- Open time se pehle expert online toggle dabaye to seedha message: "Service X baje shuru hoti hai."

## 3. Courier riders ka last-order cutoff

- Cutoff = close time − buffer (default 30 min). Iske baad naya parcel offer kisi rider ko nahi jayega.
- Pehle se accept kiya hua parcel normal chalega — delivery complete karne par hi rider offline hoga.
- Rider ki home screen par cutoff se pehle countdown patti: "Aakhri parcel 8:30 PM tak."

## 4. Expert ko apna schedule dikhega

Nayi screen **"Mere kaam ke ghante"** (Profile se link):

- Aaj ka status upar: khula hai / X baje band / aaj band hai, aur courier ke liye last-order time.
- Poore hafte ki list — har din ka open–close, band din alag dikhenge.
- Aane wale holidays ki list wajah ke saath.
- Notifications: holiday se **ek din pehle shaam ko** aur **us din subah** — dono ek hi din-ek baar, dohrayi nahi jayengi.

## 5. Purane online toggle aur stale-online cron ke saath tal-mel

- Maujuda toggle jaisa hai waisa rahega — bas online karte waqt ek aur check judega (abhi service khuli hai ya nahi).
- Purana cron jo location na milne par offline karta hai, wo alag wajah se chalta rahega. Naya hours-check usse alag chalega aur dono ek hi notification-style use karenge, to expert ko double message nahi jayega (ek baar offline hone ke baad dusra check chup rahega).
- Location gap wale offline aur hours wale offline ke message alag rahenge taki expert ko wajah samajh aaye.

## 6. Naya APK chahiye ya nahi

**Nahi.** Sab kuch web layer + database me hoga — nayi screen, banners, auto-offline, offer blocking, holiday notifications sab aapke maujuda published APK par chal jayenge (wo live site load karta hai). Holiday/offline notifications wahi push system use karenge jo already kaam kar raha hai. Koi nayi permission ya native code nahi.

## Technical details

- Tables: `service_hours` (city, service_category_id nullable, weekday 0-6, open_time, close_time, is_closed), `service_holidays` (date, city, service_category_id nullable, label, is_full_day, open_time, close_time). Dono par RLS: authenticated read, staff-only write; grants per project convention.
- `ops_settings` keys: `courier_last_order_buffer_minutes` (30), `service_hours_enforce` (1 = on).
- Helper: `public.service_window(_city, _category_id, _at)` → `{ open, closes_at, next_open_at, is_holiday, reason }`; holiday row hours ko override karti hai, category row city default ko.
- `experts` par naya column `offline_after_job boolean default false`.
- Naya pg_cron job `service-hours-autooffline` (har 5 min): band city/category ke online experts → active booking/courier order ho to `offline_after_job = true`, warna `is_online=false` + `notify_expert_alert('service_closed', ...)`. Booking/courier completion path (`credit_booking_completion` / `courier_settle_order`) me hook: flag set ho to offline + clear.
- Offer gating: `bookings` broadcast RLS policy aur `claim_booking_as_expert` me `service_window(...).open`; `courier_eligible_riders` me `now() <= closes_at - buffer`.
- `expert_set_online(true)` band hone par exception raise karega (`service_closed`), UI usse friendly message dikhayega.
- Holiday notify: daily cron 19:00 IST (T-1) + 08:00 IST (day-of), duplicate roknay ke liye `waitlist_notify_events`-style dedupe table ya `staff_notification_state` jaisa marker.
- Web: naya route `src/routes/schedule.tsx` + `useServiceWindow()` hook in `src/lib/service-hours.ts`; `home.tsx` me closing/cutoff banner aur toggle guard; `profile.tsx` me link; en/mr strings.
