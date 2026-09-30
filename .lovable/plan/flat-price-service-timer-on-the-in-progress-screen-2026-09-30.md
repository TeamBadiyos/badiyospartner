# Flat-price service timer on the In Progress screen

## Current behaviour (verified)
`StepInProgress` in `src/routes/booking.$id.tsx` already separates the two cases:
- Duration-based services (category found in `services.pricing_type = 'duration'` via `useDurationCategoryIds`) with a `service_end_at` → countdown ("Bacha hua samay" / MM:SS).
- Everything else (flat-price services: Car Wash, Bike Wash, Combo) → elapsed time since `started_at`, but it currently shows the label "Laga hua samay" with a `MM:SS` clock, which is not what was asked.

## Change

Only `src/routes/booking.$id.tsx` (StepInProgress) and the two locale files change. No backend, no database, no APK.

1. **Flat-price card format** — when `countsDown` is false, render the timer card as one line:

   `काम चालू आहे · 12 मिनिटे` (mr) / `Kaam chal raha hai · 12 min` (en)

   - Elapsed minutes only: `Math.floor(total / 60)`, ticking every minute (the existing 1s interval stays for the countdown branch; for flat services the card re-renders each second but displays whole minutes, so no visual churn).
   - The big mono `52px` MM:SS clock is not shown for flat services — the single "· N min" line replaces it, styled as large bold text on the same accent card.
   - Keep the service title line below the card as today.

2. **New locale key** in `src/lib/locales/en.ts` and `mr.ts`:
   - `job.step.elapsedMin`: `"{n} min"` / `"{n} मिनिटे"`.

3. **Countdown branch untouched** — duration-based services keep the existing "Bacha hua samay" + `MM:SS` countdown exactly as is.

Edge case: a duration-based booking with no `service_end_at` also falls into the flat branch, so it shows elapsed minutes — harmless and correct until the end time exists.

## Verification
- Typecheck passes.
- Playwright on a live booking is not possible without an in-progress flat-price job; verify by reading the rendered branch logic and confirming the locale keys resolve in both languages.
