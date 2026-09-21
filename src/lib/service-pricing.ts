import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Service categories whose services are priced by duration (time-based).
 * Only these bookings should ever show a countdown timer — flat-price
 * services (e.g. Bike Wash, Car Wash) are fixed tasks with no time limit.
 */
export function useDurationCategoryIds() {
  return useQuery({
    queryKey: ["duration-category-ids"],
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from("services").select("category_id, pricing_type");
      if (error) throw error;
      const ids = new Set<string>();
      for (const row of data ?? []) {
        if (row.pricing_type === "duration" && row.category_id) ids.add(row.category_id);
      }
      return ids;
    },
  });
}

export function isDurationBased(
  ids: Set<string> | undefined,
  categoryId: string | null | undefined,
): boolean {
  if (!ids || !categoryId) return false;
  return ids.has(categoryId);
}

/** Human label for a booking's service: prefer the stored label, fall back to minutes. */
export function serviceTitle(
  label: string | null | undefined,
  minutes: number | null | undefined,
): string {
  const trimmed = (label ?? "").trim();
  if (trimmed) return trimmed;
  return minutes ? `${minutes} min` : "—";
}
