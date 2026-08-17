/**
 * Config-revert guard.
 *
 * capacitor.config.ts carries a few settings that silently break the native
 * shell if they are reverted (status-bar overlap, wrong brand colour, losing
 * live mode / the offline cold-start page). This script fails the build when
 * any of them go missing.
 *
 * Run: `bun run scripts/check-capacitor-config.ts` (wired into `build:capacitor`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(process.cwd(), "capacitor.config.ts");
const source = readFileSync(FILE, "utf8");

type Check = { label: string; test: (s: string) => boolean };

const checks: Check[] = [
  {
    label: 'StatusBar overlaysWebView: false (prevents status-bar overlap)',
    test: (s) => /overlaysWebView\s*:\s*false/.test(s),
  },
  {
    label: 'brand background colour #0074E4 (android + ios + root)',
    test: (s) => (s.match(/#0074E4/gi) ?? []).length >= 3,
  },
  {
    label: 'server.url points at https://partner.badiyos.com (live mode)',
    test: (s) => /url\s*:\s*["']https:\/\/partner\.badiyos\.com["']/.test(s),
  },
  {
    label: 'server.errorPath: "offline.html" (offline cold start)',
    test: (s) => /errorPath\s*:\s*["']offline\.html["']/.test(s),
  },
  {
    label: 'androidScheme: "https"',
    test: (s) => /androidScheme\s*:\s*["']https["']/.test(s),
  },
  {
    label: 'iosScheme: "https"',
    test: (s) => /iosScheme\s*:\s*["']https["']/.test(s),
  },
];

const failures = checks.filter((c) => !c.test(source)).map((c) => c.label);

if (failures.length > 0) {
  console.error("\ncapacitor.config.ts is missing required settings:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error("\nRestore them before building the native shell.\n");
  process.exit(1);
}

console.log("capacitor.config.ts guard: all checks passed.");
