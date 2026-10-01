# Fix "Unresponsive UI elements" (Google Play rejection)

## What I checked already
- Reviewer account 9999900000 ("App Review Expert"): **exists, active, KYC approved, deposit collected, 3 skills, 1 zone (Latur Zone 1)**. There is no "training" field on experts, so it can't be stuck in training.
- Go Online today has **no zone check** and service hours are not enforced (switch is off), so the reviewer is not blocked there. If enforcement is turned on later, the reviewer is already bypassed.
- Go Online already shows messages for location off, permission denied, timeout, service closed.
- A few places quietly swallow errors (e.g. SOS location, bill photo GPS) — these are safe fallbacks, but need checking that the user still sees a result.

The likely cause of the rejection is buttons that look tappable but give no feedback while loading/failing, or are disabled with no reason — the audit below finds and fixes each one.

## Step 1 — Button-by-button audit (every screen)
Login, OTP, PIN, Set PIN, Not registered, Home (Go Online, offers Accept/Skip, upcoming jobs, banners), job steps 1–6 + details panel, courier job (pickup/drop OTP, scan, leave packets, photo proof), Wallet, Rewards, History, Schedule, Skills, Devices, Profile (language, logout, background location, biometric), Support, SOS, Battery guide, Legal pages.
For each control: does it do something visible within 1 second (spinner, navigation, toast, or a disabled state with a reason)?

## Step 2 — Fix rules applied everywhere
- Every action shows a spinner and blocks double taps while running.
- Every failure shows a clear toast in the user's language: no internet, server error, permission denied, service closed, outside zone, account not approved.
- Disabled buttons show a short line of text saying why (e.g. "Go Online first", "Enter all 4 digits").
- An offline banner when the phone has no internet; actions show "No internet" instead of hanging.
- Small icons get a larger tap area (at least 44px).
- Links that open the dialer/maps/settings show a toast if the phone can't open them.

## Step 3 — Reviewer account safety
- Confirm (no changes needed unless audit shows otherwise): active, approved, skills, zone, service-hours bypass.
- Add a reviewer-only guarantee in Go Online: if a zone/area check is ever added, this number skips it. Today no zone check exists, so nothing is currently blocking.
- No rows deleted.

## Step 4 — Verify and report
- Click through every screen in a test browser and check each button responds.
- Give you a list: what was broken, what was fixed. A new APK build is needed for Play resubmission.

## Technical notes
- Shared helpers: `runAction()` wrapper (pending state + mapped error toast via `friendlyError()`), `useOnline()` network hook, `DisabledReason` caption.
- `friendlyError` maps: `Failed to fetch`/offline → no internet; `SERVICE_CLOSED:` → message; `Not an expert`/`NOT_REGISTERED`; RLS/permission; generic.
- `expert_set_online`: add comment-documented reviewer bypass only if a zone check is present; otherwise untouched.
- New i18n keys in en.ts and mr.ts.
