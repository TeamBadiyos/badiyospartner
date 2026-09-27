<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Expose business-trip display metadata to riders through `courier_business_trip_display` and the existing courier offers RPC, not direct business-table reads, because business records are private and rider access must be scoped to assigned jobs or valid offers.
- Business-trip parcel scanning uses courier_scan_packet/courier_trip_packets RPCs and a lazy-loaded @zxing/browser scanner; OTP stays locked until scanned or scan_skipped_at is set, because the server rejects unscanned stops.
