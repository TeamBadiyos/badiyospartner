import { bookingSlotStart } from "./service-hours";
import type { Lang } from "./i18n";

const WEEKDAYS: Record<Lang, string[]> = {
  en: ["Rav", "Som", "Mangal", "Budh", "Guru", "Shukr", "Shani"],
  mr: ["रवि", "सोम", "मंगळ", "बुध", "गुरु", "शुक्र", "शनि"],
};

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "March", "April", "May", "June", "July", "Aug", "Sept", "Okt", "Nov", "Dec"],
  mr: ["जाने", "फेब्रु", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑग", "सप्टें", "ऑक्टो", "नोव्हें", "डिसें"],
};

const TODAY: Record<Lang, string> = { en: "AAJ", mr: "आज" };
const TOMORROW: Record<Lang, string> = { en: "KAL", mr: "उद्या" };
const NOW: Record<Lang, string> = { en: "ABHI", mr: "आत्ता" };

function clockLabel(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${String(m).padStart(2, "0")} ${suffix}`;
}

function dayDiff(slot: Date, now: Date): number {
  const a = new Date(slot.getFullYear(), slot.getMonth(), slot.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

export type SlotBadge = {
  /** e.g. "AAJ · 5:00 PM" */
  text: string;
  /** true when the slot is today (or already running) — shown in the hot colour. */
  today: boolean;
  /** true when the slot start has already passed. */
  overdue: boolean;
  start: Date | null;
};

/**
 * Big coloured schedule label used on every card and job screen.
 * "AAJ · 5:00 PM" / "KAL · 11:00 AM" / "Shukr 3 Okt · 10:00 AM".
 * Immediate ("now") bookings return "ABHI" / "आत्ता".
 */
export function slotBadge(
  booking: { scheduled_date?: string | null; scheduled_time_slot?: string | null },
  lang: Lang,
  now: Date = new Date(),
): SlotBadge {
  const start = bookingSlotStart(booking.scheduled_date, booking.scheduled_time_slot);
  if (!start) {
    return { text: NOW[lang] ?? NOW.en, today: true, overdue: false, start: null };
  }
  const diff = dayDiff(start, now);
  const time = clockLabel(start);
  let head: string;
  if (diff === 0) head = TODAY[lang] ?? TODAY.en;
  else if (diff === 1) head = TOMORROW[lang] ?? TOMORROW.en;
  else {
    const wd = (WEEKDAYS[lang] ?? WEEKDAYS.en)[start.getDay()];
    const mo = (MONTHS[lang] ?? MONTHS.en)[start.getMonth()];
    head = `${wd} ${start.getDate()} ${mo}`;
  }
  return {
    text: `${head} · ${time}`,
    today: diff === 0,
    overdue: start.getTime() < now.getTime(),
    start,
  };
}

/** Sort key for the "upcoming jobs" list: slot start, immediate jobs first. */
export function slotSortKey(
  booking: {
    scheduled_date?: string | null;
    scheduled_time_slot?: string | null;
    created_at?: string | null;
  },
): number {
  const start = bookingSlotStart(booking.scheduled_date, booking.scheduled_time_slot);
  if (start) return start.getTime();
  return booking.created_at ? new Date(booking.created_at).getTime() : 0;
}
