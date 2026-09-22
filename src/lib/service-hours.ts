import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Shape returned by the shared `service_effective_state` function. */
export type ServiceState = {
  status?: string;
  visible?: boolean;
  can_order?: boolean;
  open?: boolean;
  reason_code?: string;
  message_en?: string | null;
  message_mr?: string | null;
  open_time?: string | null;
  close_time?: string | null;
  last_order_at?: string | null;
  next_open_at?: string | null;
};

export type ServiceHourRow = {
  weekday: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean | null;
};

export type ServiceHolidayRow = {
  id: string;
  start_date: string;
  end_date: string | null;
  reason: string | null;
  reason_mr: string | null;
};

export type ServiceSchedule = {
  city: string;
  advance_lead_hours: number;
  courier_last_order_buffer_minutes: number;
  state: ServiceState | null;
  hours: ServiceHourRow[];
  holidays: ServiceHolidayRow[];
};

export type ServiceKey = "clean" | "courier" | "store";

const FALLBACK: ServiceSchedule = {
  city: "Latur",
  advance_lead_hours: 2,
  courier_last_order_buffer_minutes: 30,
  state: null,
  hours: [],
  holidays: [],
};

/** Read-only schedule + live open/closed state for one service. */
export function useServiceSchedule(serviceKey: ServiceKey, enabled = true) {
  return useQuery({
    queryKey: ["service-schedule", serviceKey],
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<ServiceSchedule> => {
      const { data, error } = await supabase.rpc("expert_service_schedule", {
        _service_key: serviceKey,
      });
      if (error) throw error;
      const raw = (data ?? {}) as Partial<ServiceSchedule>;
      return { ...FALLBACK, ...raw } as ServiceSchedule;
    },
  });
}

/** "14:30:00" -> "2:30 PM" */
export function formatTime(value?: string | null) {
  if (!value) return "—";
  const [h, m] = value.split(":");
  const hour = Number(h);
  if (Number.isNaN(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m ?? "00"} ${suffix}`;
}

/**
 * Start time of a scheduled booking, if it has one.
 * Slot strings look like "10:00-12:00"; only the start is used.
 */
export function bookingSlotStart(
  scheduledDate?: string | null,
  slot?: string | null,
): Date | null {
  if (!scheduledDate) return null;
  const head = (slot ?? "").trim().split(/\s[-–]\s|[-–]| to /)[0]?.trim() ?? "";
  const match = head.match(/^(\d{1,2})(?::(\d{2}))?\s*([APap][Mm])?/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (Number.isNaN(hour) || hour > 23) return null;
  const parsed = new Date(
    `${scheduledDate}T${String(hour).padStart(2, "0")}:${minute}:00`,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Should this unassigned booking still show in the expert's queue?
 *
 * - Immediate bookings: only while fresh (default 30 minutes).
 * - Advance bookings: from `leadHours` before the slot until the slot passes,
 *   even when the booking row itself is hours old. A brand-new booking stays
 *   visible even if its slot start has just passed.
 */
export function isBookingQueueable(
  booking: {
    created_at?: string | null;
    scheduled_date?: string | null;
    scheduled_time_slot?: string | null;
  },
  opts: { maxAgeMs: number; leadHours: number; now?: number },
): boolean {
  const now = opts.now ?? Date.now();
  const fresh = booking.created_at
    ? now - new Date(booking.created_at).getTime() <= opts.maxAgeMs
    : true;
  const slotStart = bookingSlotStart(booking.scheduled_date, booking.scheduled_time_slot);
  if (!slotStart) return fresh;
  const startMs = slotStart.getTime();
  if (now > startMs) return fresh;
  return fresh || now >= startMs - opts.leadHours * 3_600_000;
}

