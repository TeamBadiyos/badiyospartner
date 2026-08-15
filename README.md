# Badiyos Partner

Build "Badiyo Expert" — a mobile-first web app UI shell. Static/mock UI only, no backend, no database, no auth logic — just screens and navigation between them. Do NOT set up Lovable Cloud or any backend/database integration — I will connect my own Supabase project manually in a later step.

DESIGN SYSTEM (strict):

- Primary Brand: Badiyo Green #00B97A

- Secondary: Charcoal #222831 (headings, icons, dark text)

- Background: Soft White #F8FAFA, Cards: #FFFFFF

- Text: Primary #222831, Secondary #6B7280

- Border: #E5E7EB, Divider: #F1F5F9

- Font: Nunito Sans (400/500/600/700)

- 8pt spacing grid (4,8,16,24,32,48,64,96)

- Radius: Buttons 14px, Cards 18px, Inputs 14px

- Primary button: height 52px, radius 14px, weight 700, white text on #00B97A

- Icons: Lucide, rounded outline style

- Mobile-first, one primary action per screen, large touch targets

SCREENS TO BUILD (static/mock data, no backend):

1. Splash — Badiyo Expert logo/wordmark centered on green (#00B97A) background, auto-navigates to Login after ~1.5s

2. Login — Mobile number input screen, then a 4-digit OTP input screen (just UI, tapping "Verify" navigates to Home Dashboard — no real OTP check needed yet)

3. Home Dashboard — Top bar with Expert name/avatar placeholder (top-right), a large Online/Offline toggle as the primary control, and an empty state below: "Waiting for a booking"

Keep it minimal — just these three screens working end to end (Splash → Login → OTP → Home Dashboard) with the design system correctly applied. I'll give you the remaining screens in the next prompt.

Wordmark 2 logos attached on light bg use dark logo and on dark bg use white logo

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://badiyospartner.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fbf7d2d0-c2ed-40ae-9442-272eb6566693).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
