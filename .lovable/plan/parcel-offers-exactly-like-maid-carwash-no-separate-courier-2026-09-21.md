# Parcel offers: exactly like maid/carwash, no separate Courier screen

## What I found

Your screenshots come from the installed app, and they show the **old version**:
a "Courier" button in the bottom row and a separate "Courier" page listing delivery offers.

In the current project code that separate tab is already gone, and parcel offers already
appear inside the normal Home order queue with the same card, the same Accept/Dismiss
buttons, a live countdown and the same alert sound as maid/car-wash orders.
So the app on the phone is simply running an older published version.

## What this plan does

1. Publish the current version so the phone stops showing the old Courier tab and starts
   showing parcel offers in the Home queue.
2. Remove the leftover standalone offers page: opening `/courier` will send the rider
   straight to Home instead of a separate list. The active-delivery screen (Arrived,
   OTP, photo proof, report problem) stays exactly as it is — only the offers list page goes.
3. Make the alert identical to maid/car-wash: same repeating sound and vibration from the
   moment a parcel offer lands until the rider taps Accept or Dismiss, and it stops
   immediately when the offer expires or is taken by someone else.
4. Push notification tap goes to Home (not the old Courier page), so the rider lands on the
   queue with the card already visible.

No new tabs, no new screens, no new backend tables or systems.

## Technical notes

- `src/routes/courier.index.tsx`: replace list UI with a redirect to `/home`; keep
  `courier.$id.tsx` untouched.
- `src/lib/push.ts`: `routeFromData` for `type: "courier_offer"` defaults to `/home`;
  `expert-send-push` payload `route` value updated to `/home`.
- `src/routes/home.tsx`: keep the existing in-queue card; verify the sound loop starts on
  first offer and stops on accept/reject/expiry (clear loop when `courierOfferCount`
  drops to 0 including expiry-driven refetch).
- Then publish; the installed app loads the live site, so no new APK is needed for this.
