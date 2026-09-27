# Business-trip labels on courier jobs

## What changes
- On a business-trip offer and at the top of its active job, show **Trip N · <label> · <business name>** when the business-trip number and label are available. Until those fields exist, show only **<business name>**; never invent a number or label.
- At each business-trip drop, show its **C1, C2…** label next to the receiver name, following the trip’s drop order. At a business-trip pickup, show **Collect the bag for Trip N** when N exists; before then, use a number-free bag instruction.
- Leave ordinary courier and store deliveries, offers, stop actions, location, payments, and native behavior unchanged.

## Technical details
- First inspect the live business-trip schema when implementing, then map the backend’s actual `trip_no`, trip-label, and drop-label fields; do not assume their future column names or fabricate values. Identify business orders by `source = 'business'`.
- The existing business tables' read rules do not give riders access, so expose only the needed display fields through a rider-scoped read path: the existing `courier_rider_offers()` result for pending offers and a minimal authenticated, assigned-rider-only read for the active job, keyed by courier order ID and drop stop ID. Use the business profile name as the fallback heading; do not give riders direct read access to business tables or expose unrelated fields.
- Update the Home offer card and stop-based job screen to consume these display fields, including English and Marathi text. Preserve existing store and parcel presentation. Handle a partially deployed backend gracefully: business name alone when trip metadata is absent.
- Check a business offer/job and a regular courier job at mobile width; verify that the heading, drop labels, and pickup wording do not alter other job controls.
