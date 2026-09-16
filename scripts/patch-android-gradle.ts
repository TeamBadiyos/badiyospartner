/**
 * Patches the locally generated Android project so the repo-owned native
 * dependencies are always present.
 *
 * Run after `npx cap sync android` (see the `sync:android` npm script).
 * Idempotent — safe to run any number of times.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const appDir = resolve(root, "android/app");
const buildGradle = resolve(appDir, "build.gradle");
const depsGradle = resolve(appDir, "badiyo-native.gradle");
const googleServices = resolve(appDir, "google-services.json");

const APPLY_LINE = 'apply from: "badiyo-native.gradle"';

const ok: string[] = [];
const warn: string[] = [];
const fail: string[] = [];

if (!existsSync(depsGradle)) {
  fail.push("android/app/badiyo-native.gradle is missing from the repo.");
}

if (!existsSync(buildGradle)) {
  fail.push(
    "android/app/build.gradle not found. Generate the Android project first:\n" +
      "    npx cap add android   (then re-run this script)",
  );
} else {
  const original = readFileSync(buildGradle, "utf8");
  if (original.includes("badiyo-native.gradle")) {
    ok.push("build.gradle already applies badiyo-native.gradle");
  } else {
    const next = `${original.trimEnd()}\n\n// --- Badiyo Expert (managed by scripts/patch-android-gradle.ts) ---\n${APPLY_LINE}\n`;
    writeFileSync(buildGradle, next, "utf8");
    ok.push("Added `apply from: \"badiyo-native.gradle\"` to android/app/build.gradle");
  }

  if (!original.includes("com.google.gms.google-services")) {
    warn.push(
      "android/app/build.gradle does not apply the google-services plugin.\n" +
        "    Add `apply plugin: 'com.google.gms.google-services'` at the bottom and\n" +
        "    `classpath 'com.google.gms:google-services:4.4.2'` to android/build.gradle\n" +
        "    to enable push notifications.",
    );
  }
}

if (!existsSync(googleServices)) {
  warn.push(
    "android/app/google-services.json is missing.\n" +
      "    The app will build and run, but push notifications stay disabled.\n" +
      "    Download it from the Firebase console for package com.badiyos.expert.",
  );
} else {
  const gs = readFileSync(googleServices, "utf8");
  if (!gs.includes("com.badiyos.expert")) {
    warn.push(
      "android/app/google-services.json does not mention com.badiyos.expert —\n" +
        "    it is probably for a different app and push will not register.",
    );
  } else {
    ok.push("google-services.json present and matches com.badiyos.expert");
  }
}

for (const line of ok) console.log(`\u2713 ${line}`);
for (const line of warn) console.warn(`\u26a0 ${line}`);
for (const line of fail) console.error(`\u2717 ${line}`);

if (fail.length > 0) {
  console.error("\nAndroid gradle patch FAILED.");
  process.exit(1);
}

console.log("\nAndroid gradle patch OK. Next: cd android && ./gradlew assembleDebug");
