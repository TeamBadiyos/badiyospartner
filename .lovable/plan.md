# Customer note on the job screen

Show the customer's note in a highlighted box right under the address, only when the customer actually wrote one.

## What changes
- On every job screen that shows the address (on-the-way screen, details panel opened from the back arrow, and the job summary), add a soft yellow/amber box titled "Customer note" / "ग्राहकाची सूचना" with the note text below.
- If the note is empty or missing, nothing is shown.
- Nothing else on the screen changes.

## Technical details
- `src/routes/booking.$id.tsx`: add a query calling `supabase.rpc("expert_job_details", { _booking_id: id })` (backend function exists and returns `customer_note`), enabled only when the booking is assigned to this expert. Read `customer_note`, trim it, render a `CustomerNote` box after each of the three address blocks (around lines 334, 480, 730) when non-empty. Use warning semantic tokens (`bg-warning/10 border-warning/40`), `whitespace-pre-wrap break-words`.
- Add `job.note.label` to `en.ts` ("Customer note") and `mr.ts` ("ग्राहकाची सूचना").
- If the call fails, the box is simply hidden (no error toast), so the rest of the screen is unaffected.
