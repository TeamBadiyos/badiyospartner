import { CalendarClock } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { slotBadge } from "@/lib/slot-label";

/**
 * Big, loud, coloured schedule label. Shown on every job card and on every
 * step of the job screen so the expert can never miss the time.
 */
export function SlotChip({
  booking,
  size = "md",
  className = "",
}: {
  booking: { scheduled_date?: string | null; scheduled_time_slot?: string | null };
  size?: "md" | "lg";
  className?: string;
}) {
  const lang = useLang();
  const badge = slotBadge(booking, lang);

  const tone = badge.overdue
    ? "bg-[color:var(--color-destructive)] text-white"
    : badge.today
      ? "bg-[#F59E0B] text-[#1A1A1A]"
      : "bg-primary text-primary-foreground";

  const dims =
    size === "lg"
      ? "px-4 py-2.5 text-[17px] gap-2"
      : "px-3 py-1.5 text-[14px] gap-1.5";

  return (
    <span
      className={`inline-flex items-center rounded-full font-extrabold tracking-wide ${tone} ${dims} ${className}`}
    >
      <CalendarClock className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} strokeWidth={2.6} />
      {badge.text}
    </span>
  );
}
