# Fix reviewer PIN login ("NO_PIN")

## What I found (verified in the database)

1. The review account **+91 9999900000** ("App Review Expert") exists, is **active** and **KYC approved**, with a linked login account — so it is not blocked.
2. Its **PIN is simply not set** (`pin_hash` is empty). That is exactly why PIN login answers `NO_PIN`.
3. A second, wider bug: the "does this number have a PIN?" check looks in the **customer** table instead of the expert table. Of 14 experts who have set a PIN, **10 are invisible to that check** — those experts are always pushed to the OTP screen instead of the PIN screen, even though their PIN works.

## What will be fixed

### 1. Set a permanent PIN for the review account
Store the fixed PIN **1234** for 9999900000 directly in the database. Nothing expires or resets it — no cron, sweeper, or normal app flow clears a stored PIN.

### 2. Make the PIN check read the expert table
Rewrite the lookup so a number counts as "has PIN" when the matching **active expert** has a PIN stored (keeping the customer-table fallback so nothing else breaks). This fixes the reviewer and the 10 other affected experts in one go.

### 3. Protect the review PIN from lockout
Clear any existing failed-attempt lockout for 9999900000, and make PIN verification skip the 5-wrong-attempts lockout for the review number, so a reviewer who mistypes cannot lock themselves out for 15 minutes.

### 4. Verify the whole login journey
After the change, test end to end against the live backend:
- OTP path: request code for 9999900000 → code **1234** accepted → session issued.
- Set PIN path: saving a 4-digit PIN stores it on the expert record.
- PIN path: fresh login with PIN **1234** → session issued; wrong PIN → "incorrect PIN" but no lockout for this number.
- Account state check: active + approved, so the app lands on Home rather than the "not registered" screen.

## Technical notes

- One migration: `UPDATE public.experts SET pin_hash = crypt('1234', gen_salt('bf'))` for the review phone; `CREATE OR REPLACE FUNCTION public.has_login_pin(text)` to check `public.experts` (active, phone match on last 10 digits) OR `public.users`; `CREATE OR REPLACE FUNCTION public.verify_login_pin_internal(text, text)` with a review-phone bypass of the `pin_login_lockouts` branch; `DELETE FROM public.pin_login_lockouts WHERE phone = '9999900000'`.
- Both functions stay `SECURITY DEFINER` with pinned `search_path`, and their existing grants are preserved (service-role only for the internal verify).
- No app/UI code changes, no edge function redeploy, no new APK needed.
