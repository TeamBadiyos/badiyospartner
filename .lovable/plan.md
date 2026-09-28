# Business trip drop: bill photo proof

## What changes (business trip drop stops only)
Once all of a drop's packets are scanned (or support skipped the scan), the business's proof setting decides what comes next:
- **OTP only:** same as today.
- **Bill photo only:** no OTP box. The rider sees "Take a photo of the signed/stamped bill".
- **OTP or photo:** two big buttons, "Enter OTP" and "Take bill photo". Either one completes the drop, and the rider can switch between them.

**Photo step**
- Uses the phone camera inside the app, with no gallery or file picker. The rider takes 1 to 5 photos, and each thumbnail has an ✕ to delete it and take another.
- Before upload, each photo is shrunk to 1600 px on its longest side, saved as a JPEG at 0.75 quality, and stamped with a small footer: the sticker numbers, date and time, and GPS position.
- The app gets a fresh GPS reading with its accuracy, uploads each photo, completes the drop, and then shows Delivered.
- If the shop's location isn't saved yet, the screen says "This shop's location will be saved for the first time".

**Errors, in simple words**
- Too far away: "You are X m from the shop — go to the shop and take the photo". For a shop's first delivery: "You are X m from the map pin".
- Packets not scanned: "Scan all of this shop's packets first", and the scan step opens again.
- Photo required: "This business requires a bill photo".
- Already completed: the stop refreshes quietly.
- Upload fails or there's no internet: the photos stay on screen with a **Retry** button. Delivered only shows after the server confirms the drop.

The text is in English and Marathi, like the rest of the app. Pickup, leaving packets behind, failing a stop, returns, customer courier orders and store deliveries stay exactly as they are.

## Technical details
- Checked: the setting comes back as `drop_proof_mode` in `courier_trip_packets` (it applies to the whole trip, default `otp`). `courier_complete_drop_with_proof` returns `{ok:false, reason}` with `MODE_OTP`, `ALREADY_COMPLETED`, `LOCATION_REQUIRED`, `packets_not_scanned`, `PHOTO_COUNT`, `PHOTO_NOT_FOUND`, `NO_RECEIVER_LOCATION`, `OUTSIDE_GEOFENCE` (`distance_m`, `limit_m`, `first_delivery`). Photo paths must match `<merchant_id>/…/<stop_id>/…` in the `delivery-proofs` bucket. When building, read the rest of the function to confirm the success shape and PHOTO_REQUIRED.
- The upload-url endpoint lives in the Customer App project. When building, read its code to get the exact body and response (signed URL + path) and the error codes. Then call it with the rider's access token, PUT the JPEG to the signed URL, and collect the paths.
- Also when building: check whether `courier_trip_packets` returns a per-packet or per-stop "location verified" flag for the first-delivery note. If it doesn't, rely on `first_delivery` from the complete response instead.
- `src/lib/courier.ts`: add `drop_proof_mode` to `TripPacketsData`, plus `getProofUploadUrl()` and `completeDropWithProof()` helpers.
- New `src/components/bill-photo-capture.tsx`: a live `getUserMedia` preview using the rear camera, capture to canvas, resize and footer, keep the photos in memory, and stop the camera when the step closes.
- `src/routes/courier.$id.tsx`: after the drop scan is complete, branch on the mode. The OTP path stays unchanged. Map errors to the messages above, and refetch the route and packets after success or ALREADY_COMPLETED.
- New en/mr locale keys. No database or native changes.
