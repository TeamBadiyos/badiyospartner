# Service Hours — Expert App Plan (Revised)

Sab kuch read-only: Customer App `service_flags` + `service_hours`/`service_holidays` tables aur `service_effective_state()` function banayega. Expert App sirf padhega — koi nayi table ya function yahan nahi banegi.

## 1. Data ka source (Customer App project)

- `service_flags` (service_key: clean/store/courier, city, is_active) — already hai, aur `bookings_check_service_flag` trigger se booking banate waqt block bhi karti hai.
- `service_effective_state(_service_key, _city, _at)` — Customer App plan se exact naam/signature liya jayega; return: open/closed, closes_at, next_open_at, status (Coming Soon / Temporarily Stopped), holiday info. Expert App iska koi doosra overload nahi banayega.
- Expert App ko sirf `service_hours`, `service_holidays` par SELECT aur `service_effective_state` par EXECUTE chahiye — ek chhota migration sirf grants ke liye (agar Customer App ne authenticated ko grant na ki ho).

## 2. Close time par apne aap offline

- Naya pg_cron job har 5 minute: online experts me se jinki city+service band ho chuki hai —
  - **Active job ho** (booking assigned/in_progress ya parcel picked up) → `experts.offline_after_job = true` set, turant offline nahi.
  - **Koi job na ho** → `is_online = false` + soft notification "Service band ho gayi, aap offline kar diye gaye hain."
- `offline_after_job` ka cleanup usi 5-minute cron me: flag wala expert ab active job-free ho to offline + flag clear. Completion functions (`credit_booking_completion`, `courier_settle_order`) ko haath nahi lagega.
- Cron poora exception-wrapped aur early-exit: `service_hours_enforce` = 0 ho ya koi expert band service me na ho to turant return; har expert ka kaam alag BEGIN/EXCEPTION block me taaki ek failure baaki ko na roke.
- **Efficiency:** `service_effective_state` har expert ke liye nahi — pehle sirf un (service_key, city) jodiyon ke liye ek-ek baar call hoga jinme koi online expert hai, uska result ek temp map me rakha jayega, phir experts ko usi map se match kiya jayega.
- Online toggle: `expert_set_online(true)` band service par exception `service_closed` raise karega; UI friendly message dikhayega ("Service X baje shuru hoti hai").

## 3. Cutoff sirf courier offers par

- `courier_eligible_riders` me ek check: `now() <= closes_at - courier_last_order_buffer_minutes` (default 30 min). Iske baad naya parcel offer kisi rider ko nahi jayega.
- Home service (clean) offers ko now() ke basis par gate **nahi** karenge — `claim_booking_as_expert` aur broadcast RLS policy ko koi change nahi.
- Accept ho chuka parcel normal complete hoga; rider tabhi offline hoga jab delivery khatam ho.

## 4. Advance bookings ka dispatch — current behavior aur risk

- Booking `accepted` status par aate hi `on_booking_broadcast_start` trigger turant broadcast shuru kar deta hai — scheduled_date ka intezaar nahi hota. Yani raat 9 PM par kal ki booking bane to wo abhi hi experts ko dikhti hai.
- `auto-expire-unassigned-bookings` cron (har minute, Customer App hook) unassigned bookings ko `no_expert_timeout_minutes` (default 30 min) ke baad cancel kar deta hai — `system_list_expired_unassigned_bookings` scheduled_date nahi dekhta.
- **Risk:** 7 PM ke baad sab experts offline hon to raat me bani kal ki booking ~30 min me auto-cancel ho sakti hai. Ye behavior Customer App ke expire hook me hai.
- **Test (build ke baad):** ek booking kal ki date ke saath banayein jab koi expert online na ho → 30+ min baad check karein ki booking cancel hui ya nahi. Agar cancel ho rahi hai, to Customer App hook me "future-scheduled bookings ko expire mat karo" ka fix alag se chahiye hoga (wo Customer App project ka kaam hai).
- **Gate:** `service_hours_enforce` tab tak 0 hi rahega jab tak Customer App project me advance-booking expiry ka fix aur upar wala test pass na ho jaye. Enforce ON karna ek alag, baad ka step hai.

### Subah online aane par pending advance bookings

- Expert subah online hota hai to broadcast dobara nahi chalta — `on_booking_broadcast_start` sirf booking ke `accepted` hone par ek baar chalta hai.
- Expert ko ye bookings Home ki **catch-up list** se milti hain: online hote hi Home `accepted` + unassigned + approved-skill wali bookings query karta hai (radius aur 30-min max-age filter ke saath), aur wahi cards queue me dikhte hain.
- **Catch-up ka max-age slot-aware hoga:** ab sirf "30 minute se nayi" nahi. Booking queue me dikhegi agar — (a) wo aaj/abhi ke liye hai aur 30 min ke andar bani hai, **ya** (b) advance booking hai, abhi bhi unassigned hai aur uska slot abhi guzra nahi — chahe wo raat ki bani ho. Advance booking slot se `advance_booking_expire_before_slot_hours` (Customer App setting, default 2) pehle se queue me aa jayegi, aur slot nikal jaane par hat jayegi. Yahi window Customer App ke expiry fix se match karegi.

### Duplicate service-flag check ka sawaal

- Abhi `bookings_check_service_flag` trigger (BEFORE INSERT par) city + `service_key='clean'` dekh kar booking block karta hai.
- Customer App plan me `bookings_before_insert` me bhi service/hours check aa raha hai — dono ek saath rahe to **duplicate** ho jayega (do jagah alag-alag error message, ek badle to doosra reh jaye).
- Decision: **ek hi check rahega** — Customer App ke `bookings_before_insert` me consolidated check, aur `bookings_check_service_flag` trigger + function ka DROP **Customer App ke us hi migration me** likha jayega (Expert App me bilkul nahi). Customer App plan me is drop ka zikr add karwana hai, taaki wahan se chhoot na jaye. Expert App ka koi code is trigger par depend nahi karta.

### expert_set_online ka merge (ek hi version)

- Do requirement ek hi function par aa rahi hain: Customer App plan (section 9a) ka subah re-broadcast hook, aur is plan ka service-closed guard + bypass.
- **Maalikana: Customer App project.** `expert_set_online` shared DB me hai, isliye ek hi merged `CREATE OR REPLACE` Customer App ke migration me jayega. Expert App apna alag version replace nahi karega (warna jo baad me chalega wo doosre ko mita dega).
- Merged function ka order:
  1. Expert row + phone nikalo.
  2. `_online = false` → seedha offline set karke return (guard sirf online karte waqt).
  3. Bypass check: phone `service_hours_bypass_phones` me ho (key missing = khaali list) → guard skip.
  4. `service_hours_enforce = 1` ho to `service_effective_state(service_key, city, now())` — band ho to exception `service_closed` (message me next open time).
  5. `is_online = true` set + `offline_after_job = false` clear.
  6. Re-broadcast hook (Customer App 9a): expert ke radius/skill se matching pending unassigned bookings ko dobara broadcast/queue karo.
- Expert App ki taraf se sirf itna: UI me `service_closed` ka friendly message, aur is merged function par depend karna — koi apna overload nahi.
- **Confirm: build ke baad Expert App `expert_set_online` ko bilkul nahi chhuyega** — na replace, na overload, na naya wrapper. Sirf call karega aur uska error handle karega.

### Double offer / double notification se bachav

Subah expert online hote hi do cheezein chal sakti hain — merged function ka re-broadcast hook, aur Home ki catch-up list. Ye aapas me kaise milte hain:

- **Card ek hi banega.** Home ki queue booking `id` se de-duplicate hoti hai (`Map`/`Set` key = booking id). Chahe wahi booking re-broadcast se realtime event ban kar aaye ya catch-up query se, dono ek hi card bante hain — do nahi.
- **Awaaz ek hi bajegi.** Alert sound loop queue ke "kitne live cards hain" par chalta hai, per-event nahi. Do raste se aayi ek hi booking ek hi ring banati hai.
- **Push ek hi jayega.** Re-broadcast hook hi push bhejta hai; catch-up list sirf padhti hai, koi notification nahi bhejti. Yani push ka ek hi malik hai.
- **Pehle se dismiss/reject ki hui booking dobara ring nahi karegi.** Persisted dismissal aur reject record queue me respect hote hain, to re-broadcast usi booking ko dobara zabardasti nahi bajaega.
- Yahi behavior test me verify hoga: ek pending advance booking ke saath expert ko offline se online karein → exactly ek card, ek ring, ek push.


## 5. Test/reviewer accounts bypass

- Auto-offline cron aur online-block dono me bypass list: reviewer (+919999900000) aur test accounts (jaise Gaurav/Nikhil/Rushi test experts).
- Bypass `ops_settings` key `service_hours_bypass_phones` (comma-separated) se — hardcode nahi, admin badal sakta hai.
- Reviewer ka number seed hoga; agar row kisi wajah se na ho to koi error nahi aayega — bas bypass lagu nahi hoga (missing key → khaali list, normal rules chalengi).


## 6. "Mere kaam ke ghante" screen (read-only)

- Naya route `src/routes/schedule.tsx`, Profile se link.
- Upar aaj ka status: khula / X baje band / aaj band — saath me service ka state badge (Coming Soon, Temporarily Stopped) agar `service_effective_state` bataye.
- Poore hafte ke open–close times, band din, aane wale holidays wajah ke saath.
- Courier ke liye last-order time alag line me.
- Sirf padhne ke liye — koi edit nahi.

## 7. Holiday notifications

- Daily cron: ek din pehle shaam (19:00 IST) aur us din subah (08:00 IST) — dono ek baar, dedupe marker ke saath.
- Wahi `notify_expert_alert` push system use hoga jo abhi kaam kar raha hai.

## 8. Settings

- `service_hours_enforce` — default **0** (off), aur 0 hi rahega jab tak Customer App ka advance-booking expiry fix + test pass na ho. 1 karne par auto-offline aur courier cutoff active honge.
- `courier_last_order_buffer_minutes` — default 30.
- `service_hours_bypass_phones` — reviewer (+919999900000) seed; key missing ho to error nahi, sirf bypass nahi lagega.

## 9. Naya APK chahiye?

**Nahi — confirm.** Sab kuch web layer + database me hai: schedule screen, banners, auto-offline, courier cutoff, holiday push — sab maujuda published APK par chalega (wo live site load karta hai). Koi nayi permission ya native code nahi.

## Technical details

- Migration 1 (grants): `service_hours`, `service_holidays` par SELECT to authenticated; `service_effective_state` par EXECUTE to authenticated (sirf agar Customer App ne na di ho — `IF EXISTS` guarded).
- Migration 2 (expert app logic): `experts.offline_after_job boolean default false`; `ops_settings` inserts (enforce=0, buffer=30, bypass phones seed `9999900000`, `ON CONFLICT DO NOTHING`); `public.service_hours_autooffline()` SECURITY DEFINER — early-exit on enforce=0, `service_effective_state` per distinct (service_key, city) once into a temp map, per-expert exception blocks, `offline_after_job` set/clear, `notify_expert_alert('service_closed', ...)`; `courier_eligible_riders` me cutoff check; pg_cron job `service-hours-autooffline` har 5 min; holiday notify cron 19:00/08:00 IST + dedupe marker.
- **Customer App project me (Expert App me nahi):** merged single `expert_set_online` (guard + bypass + 9a re-broadcast), `bookings_before_insert` consolidated check, `DROP TRIGGER`/`DROP FUNCTION bookings_check_service_flag`, `advance_booking_expire_before_slot_hours` (default 2) aur advance-booking expiry fix.
- Web: `src/lib/service-hours.ts` (`useServiceState()` hook — `service_effective_state` RPC + hours/holidays select), `src/routes/schedule.tsx`, `home.tsx` me closing-soon/cutoff banner, slot-aware catch-up filter, aur toggle ka `service_closed` friendly error, `profile.tsx` link, en/mr strings.
- Files touched (Expert App): `supabase/migrations/*` (2), `src/lib/service-hours.ts` (new), `src/routes/schedule.tsx` (new), `src/routes/home.tsx`, `src/routes/profile.tsx`, `src/lib/locales/en.ts`, `src/lib/locales/mr.ts`.
- Verify: `bunx tsgo --noEmit`; SQL test — enforce=1, ek test expert online + service band → cron run → offline + notification; bypass phone wale expert online rahe; courier cutoff ke baad `courier_eligible_riders` khaali; advance-booking expire test (section 4).
