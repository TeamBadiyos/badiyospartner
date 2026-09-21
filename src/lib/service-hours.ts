import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Shape returned by the shared `service_effective_state` function. */
export type ServiceState = {
  status: string;
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
  resume_at?: string | null;
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

const DEFAULT_CITY = "Latur";

/** City of the expert, resolved from their zone (falls back to Latur). */
export function useExpertCity(zoneId: string | null | undefined) {
  return useQuery({
    queryKey: ["expert-city", zoneId ?? null],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      if (!zoneId) return DEFAULT_CITY;
      const { data, error } = await supabase
        .from("zones")
        .select("city")
        .eq("id", zoneId)
        .maybeSingle();
      if (error) throw error;
      return data?.city ?? DEFAULT_CITY;
    },
  });
}

/** Live open/closed state for one service in one city. Read-only. */
export function useServiceState(serviceKey: "clean" | "courier" | "store", city?: string | null) {
  return useQuery({
    queryKey: ["service-state", serviceKey, city ?? DEFAULT_CITY],
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("service_effective_state", {
        _service_key: serviceKey,
        _city: city ?? DEFAULT_CITY,
      });
      if (error) throw error;
      return (data ?? null) as ServiceState | null;
    },
  });
}

/** Weekly hours + upcoming holidays for the read-only schedule screen. */
export function useServiceSchedule(serviceKey: "clean" | "courier" | "store", city?: string | null) {
  return useQuery({
    queryKey: ["service-schedule", serviceKey, city ?? DEFAULT_CITY],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data: flag, error: flagErr } = await supabase
        .from("service_flags")
        .select("id, service_key, city, status, hours_enabled, last_order_buffer_minutes")
        .eq("service_key", serviceKey)
        .eq("city", city ?? DEFAULT_CITY)
        .maybeSingle();
      if (flagErr) throw flagErr;
      if (!flag) return { flag: null, hours: [] as ServiceHourRow[], holidays: [] as ServiceHolidayRow[] };

      const today = new Date().toISOString().slice(0, 10);
      const [hoursRes, holsRes] = await Promise.all([
        supabase
          .from("service_hours")
          .select("weekday, open_time, close_time, is_closed")
          .eq("service_flag_id", flag.id)
          .order("weekday"),
        supabase
          .from("service_holidays")
          .select("id, start_date, end_date, reason, reason_mr")
          .or(`service_flag_id.eq.${flag.id},service_flag_id.is.null`)
          .gte("start_date", today)
          .order("start_date")
          .limit(20),
      ]);
      if (hoursRes.error) throw hoursRes.error;
      if (holsRes.error) throw holsRes.error;
      return {
        flag,
        hours: (hoursRes.data ?? []) as ServiceHourRow[],
        holidays: (holsRes.data ?? []) as ServiceHolidayRow[],
      };
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
  const start = (slot ?? "").trim().split(/[-–to]/)[0]?.trim() ?? "";
  const time = /^\d{1,2}:\d{2}/.test(start) ? start.slice(0, 5) : "00:00";
  const parsed = new Date(`${scheduledDate}T${time.padStart(5, "0")}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Should this unassigned booking still show in the expert's queue?
 *
 * - Immediate bookings: only while they are fresh (default 30 minutes).
 * - Advance bookings: from `leadHours` before the slot until the slot passes,
 *   even when the booking row itself is hours old.
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
  if (now > startMs) return false; // slot already passed
  return fresh || now >= startMs - opts.leadHours * 3_600_000;
}

/** Lead time (hours) before an advance booking's slot, from shared settings. */
export function useAdvanceLeadHours() {
  return useQuery({
    queryKey: ["advance-lead-hours"],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ops_settings")
        .select("value")
        .eq("key", "advance_booking_expire_before_slot_hours")
        .maybeSingle();
      if (error) throw error;
      const parsed = Number(data?.value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
    },
  });
}
