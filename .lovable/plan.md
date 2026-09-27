# Packet numbers, manual entry and packet counts on business trips

## What changes (business trips only)
1. **Type number** — on both the pickup and drop scan steps, the current "Type code" button becomes **Type number**. It opens a number keypad. What the rider types is sent as a manual entry, and the success and error messages are the same as for a camera scan. Packets entered by hand show a small **manual** tag.
2. **Printed numbers everywhere** — packet numbers look like the sticker (104521-7) in the scan messages, the packet list and the stop details.
3. **Drop stop packet list** — each drop shows "This shop's 3 packets" with every packet number and a scanned / not-scanned mark (plus the manual tag when it applies). The existing rule stays: the OTP stays locked until all of that drop's packets are scanned.
4. **Packet count in the trip summary** — the job header and the finished-job screen show "8 stops · 23 packets" next to the earning.
5. **Camera debounce** — the same code read again within 2 seconds is ignored. Typed entries are never ignored.

Nothing else changes: arrive, OTP, fail stop, return, customer courier orders and store deliveries all stay as they are today.

## Language note
The app shows only English and Marathi, so "Is dukaan ke 3 packet" will appear as "This shop's 3 packets" in English plus a Marathi version, not in Hindi. Tell me if you want Hindi shown here anyway.

## Technical details
- The backend is already live (checked): `courier_scan_packet(..., _entry_method 'scan'|'manual')` accepts BDY1045217, 1045217 and 104521-7 and stores `pickup_entry_method` / `drop_entry_method`. `courier_trip_packets` returns those fields plus `printed_code` and `is_seal`. No database changes are needed.
- `src/lib/courier.ts`: add `printed_code`, `is_seal`, `pickup_entry_method` and `drop_entry_method` to `TripPacket`. Add an `entryMethod` parameter to `scanPacket()` (default 'scan').
- `src/components/packet-scanner.tsx`: the manual input becomes `inputMode="numeric"` and allows digits, "-" and a "BDY" prefix. It submits with 'manual' and skips the debounce. The camera path sends 'scan' with a 2000 ms same-code debounce. Pass the stop's packets in to render the list (printed code, scanned mark, manual tag). The ok message shows the matching packet's printed code, found after the refetch.
- `src/routes/courier.$id.tsx`: pass the packets filtered for the current stop (all packets at pickup, packets matching `drop_stop_id` at a drop) into the scanner. The header and completion screen show `stops.length` stops · `packets.length` packets when source = 'business'. The OTP gating logic stays as it is.
- en/mr keys: `courier.scan.typeNumber`, `courier.scan.manualTag`, `courier.scan.shopPackets`, `courier.summary.stopsPackets`.
- The offer card before accepting has no packet count from the server, so the packet count appears on the job screen only.
