# Notification audit — what works, what's broken, what's missing

I checked every notification path end to end: what the database sends, what the phone receives, and what the app does with it. Overall the system is healthy — push delivery is working (all recent sends returned success), tokens are registered for 9 partner devices, and the background jobs that re-broadcast and expire jobs are all running.

Three real problems came out of it.

## 1. Support "resolved" notification never reaches the partner (confirmed bug)

When staff resolve a partner's support ticket, the notification is sent to the wrong identity. Partner devices are registered under their partner record, but the ticket resolution sends to their login account instead. Customers are unaffected (their two IDs are the same); for partners the message is silently dropped.

Fix: translate the ticket owner to the partner record before sending, so the message lands. Also make tapping that notification open the Help & Support screen instead of doing nothing.

## 2. Missing notifications for steps that currently pass in silence

These moments happen today with no message to the partner at all:

- Money credited for a completed job (payout added to wallet)
- Tip received from a customer
- Reward or bonus credited
- Skill request approved or rejected by the office
- Onboarding/KYC decision (approved or rejected)
- Being switched offline by the office, or auto-switched offline after a long period with no location update

Each becomes a normal (non-ringing) notification that opens the matching screen: Wallet, Rewards, Skills, Home.

## 3. Confirmed working — no change needed

- New nearby job broadcast, including full-screen ringing alert when the phone is locked
- Job assigned directly by the office
- Customer cancels a job the partner is on
- Customer requests extra time
- 10-minute completion reminder
- Automatic re-broadcast with a wider radius, and flagging jobs no one accepted

## Technical notes

- Root cause of item 1: `notify_support_ticket_resolved` passes `NEW.user_id` (auth uid) into `notify_push_event`, but `device_tokens.user_id` for experts holds `experts.id` (verified: 9/9 expert tokens match `experts.id`, 0 match `auth_user_id`). Resolve via `experts.auth_user_id = NEW.user_id` before the call.
- New notifications go through the existing `notify_expert_alert(expert_id, alert_type, title, body, data)` helper, added inside `resolve_booking_payouts`, `record_booking_tip`, `reward_apply_credit`, `staff_assign_partner_skill`, `staff_area_partner_kyc_decision`, and `expire_stale_online_experts` / the staff force-offline path. Each wrapped in its own exception block so a push failure can never roll back the business transaction.
- New `alert_type` values (`payout_credited`, `tip_received`, `reward_credited`, `skill_decision`, `kyc_decision`, `forced_offline`) are deliberately kept OUT of `BadiyoMessagingService.isRingAlert`, so they show as ordinary tray notifications, not full-screen alarms.
- `src/lib/push.ts` `routeFromData` gains cases for `support_resolved` → `/support`, wallet/tip/reward → `/wallet` or `/rewards`, skill → `/skills`.
- Locale strings are not needed (notification text is composed server-side), but the in-app toast fallback keys stay in `en.ts`/`mr.ts` where used.
- No schema changes; database work is one migration of `CREATE OR REPLACE FUNCTION` statements.

## Verification

Each item tested independently by triggering the underlying action against a real record and confirming a send is logged, plus a typecheck after the app changes.
