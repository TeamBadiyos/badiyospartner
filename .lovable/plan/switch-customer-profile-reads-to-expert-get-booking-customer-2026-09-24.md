# Switch customer profile reads to expert_get_booking_customer

## Findings
- Only one place in the app reads the customer's profile from the users table: the booking screen (`src/routes/booking.$id.tsx`, line 88), which loads `full_name, phone` to show the Call button.
- No joins to users exist anywhere else (web code or native Android sources).
- The RPC `expert_get_booking_customer` does **not** exist in the database yet.

## Steps
1. Create the RPC (migration): `expert_get_booking_customer(_booking_id uuid) returns table(full_name text, phone text)`, SECURITY DEFINER, `search_path = public`. Returns a row only when the booking's `assigned_expert_id` is the caller's expert record (matched via auth.uid()); otherwise empty. Revoke from PUBLIC/anon, grant to authenticated.
2. Update the booking screen query to call the RPC with the booking id and read the first row.
3. Re-grep the whole project to confirm no remaining reads of the users table for customers.

Nothing else changes; the broad technician read policy on users is left as-is unless you ask to remove it.
