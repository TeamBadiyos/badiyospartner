# Business trip pickup — leave packets behind (partial pickup)

Business trips only, pickup stop only. Drop scan, OTP, arrive, fail stop, return and customer/store orders stay exactly as they are.

## What the rider sees
1. **Pickup packet list** — every packet not yet scanned gets a "Packet not found" button. A "None of the rest found" button selects all remaining unscanned packets.
2. **Bottom sheet** — lists the selected packet numbers (104521-0 style, or the old code when a packet has no sticker), reason chips: Not ready / Business held it / Damaged / Other (Other needs a note). Confirm line: "Leaving N packets — they will go in the next slot."
3. **Errors in simple words**
   - Already scanned: "This packet is already scanned, it can't be left."
   - No-sticker packets of one shop must go together: shows "All no-sticker packets of this shop must be left together", auto-selects the rest of that shop's no-sticker packets, and waits for the rider to confirm again.
4. **After success** — left packets move into a greyed "Left behind" section with the reason; shops with no packets left drop off the route; the earning at the top refreshes to the new amount.
5. **Leaving everything** — if the selection covers every remaining packet, a warning first: "The whole trip will be cancelled". On success: "Trip cancelled" and the rider goes back to Home.
6. **Business removes packets** — the list refreshes and a toast says "Business removed N packets".
7. **Pickup OTP** stays locked until every *remaining* packet is scanned (left packets no longer count).
8. **Trip label** shows as T1, T2…; drop labels stay C1, C2…

## Language note
The app shows only English and Marathi, so the Hinglish lines above ("Packet nahi mila", "Chhode gaye"…) will appear as English plus Marathi, like the earlier scan screens. Tell me if you want the Hinglish wording shown instead.

## Technical details
- Backend checked (no changes): `courier_rider_leave_packets(_courier_order_id, _packet_ids, _reason_code, _notes)` returns `{ok:true, trip_cancelled:false, codes, packets_removed, refund, new_total, drops_left}`, `{ok:true, trip_cancelled:true, codes}`, or `{ok:false, reason}` with `packet_scanned | select_all_unsealed_packets_of_drop | not_in_trip | pickup_done`. OTHER without notes raises an error. `courier_trip_packets` returns `trip_no` and `removed_packets[]` (code, drop_label, receiver_name, reason, notes, removed_by, removed_at); removed packets are no longer in `packets`.
- `src/lib/courier.ts`: `useCourierTripPackets` returns `{ packets, removed, trip_no }`; add `RemovedPacket` type and `leavePackets()` wrapper.
- New `src/components/leave-packets-sheet.tsx` (existing Sheet component): selection, reason chips, note, confirm, all-remaining warning. On `select_all_unsealed_packets_of_drop`, add every unscanned `is_seal=false` packet with the same `drop_stop_id` to the selection.
- `src/components/packet-scanner.tsx` (pickup only): per-packet button, select-rest button, greyed "Left behind" section.
- `src/routes/courier.$id.tsx`: after success invalidate packets, route (stops) and order (earning); on `trip_cancelled` toast + navigate to `/home`. Pickup total counts only remaining packets. Hide drop stops that have zero remaining packets for business trips. Trip heading uses `T{trip_no}`.
- Business removals: only `courier_orders` is in realtime, and its total changes on removal — subscribe to that order row, plus poll packets every 10s while at pickup. When the count of `removed_by='business'` entries grows, toast "Business removed N packets" with the difference.
- New en/mr keys under `courier.leave.*`.
