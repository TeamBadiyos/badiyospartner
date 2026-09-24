// Courier (bike delivery) helpers for the rider app.
// All writes go through existing SECURITY DEFINER RPCs — no client-side
// mutation of courier tables.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setNativeLocationMode } from "@/lib/background-location";

export const COURIER_CATEGORY_NAME = "Courier Delivery";

/** Statuses where the rider is actively working a courier job. */
export const COURIER_ACTIVE_STATUSES = [
  "DRIVER_ASSIGNED",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
] as const;

/** Parcel is in the rider's hands — cancel must be impossible from here on. */
export const COURIER_NO_CANCEL_STATUSES = ["PICKED_UP", "IN_TRANSIT", "DELIVERED", "FAILED_DELIVERY"];

export type CourierOffer = {
  offer_id: string;
  order_id: string;
  order_code: string | null;
  expires_at: string;
  distance_to_pickup_km: number | null;
  pickup_area: string | null;
  drop_area: string | null;
  trip_km: number | null;
  earning: number | null;
  parcel: string | null;
  source?: string | null;
  store_name?: string | null;
  item_count?: number | null;
  pickup_count?: number | null;
  drop_count?: number | null;
};

export type CourierStop = {
  id: string;
  order_id: string;
  stop_type: "pickup" | "drop" | "return";
  sequence: number;
  lat: number | null;
  lng: number | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: string;
  arrived_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
};
export type CourierParcel = {
  id: string;
  pickup_stop_id: string | null;
  drop_stop_id: string | null;
  return_stop_id: string | null;
  status: string;
};
export type CourierCharge = {
  id: string;
  parcel_id: string | null;
  charge_type: string | null;
  amount: number | null;
  total_amount: number | null;
  status: string;
};

/** Stops, parcels and charges for an order. Polls every 10s while `fast`. */
export function useCourierRoute(orderId: string, fast: boolean) {
  return useQuery({
    queryKey: ["courier-route", orderId],
    refetchInterval: fast ? 10_000 : 15_000,
    queryFn: async () => {
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const [s, p, c] = await Promise.all([
        db.from("courier_order_stops")
          .select("id, order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone, status, arrived_at, completed_at, failed_at")
          .eq("order_id", orderId).order("sequence", { ascending: true }),
        db.from("courier_order_parcels").select("id, pickup_stop_id, drop_stop_id, return_stop_id, status").eq("order_id", orderId),
        db.from("courier_order_charges").select("id, parcel_id, charge_type, amount, total_amount, status").eq("order_id", orderId),
      ]);
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      if (c.error) throw c.error;
      return {
        stops: (s.data ?? []) as CourierStop[],
        parcels: (p.data ?? []) as CourierParcel[],
        charges: (c.data ?? []) as CourierCharge[],
      };
    },
  });
}

export type CourierStoreInfo = { store_name: string | null; order_number: string | null; item_count: number | null };

/** Store name / order no / item count for the rider's assigned store job. */
export function useCourierStoreInfo(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["courier-store-info", orderId],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("courier_store_info" as never, { _order_id: orderId } as never);
      if (error) throw error;
      return (data as unknown as CourierStoreInfo | null) ?? null;
    },
  });
}

export type CourierOrder = {
  id: string;
  order_code: string | null;
  status: string;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  drop_address: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  drop_contact_name: string | null;
  drop_contact_phone: string | null;
  package_description: string | null;
  weight_kg: number | null;
  distance_km: number | null;
  base_amount: number | null;
  extra_fee: number | null;
  commission_pct: number | null;
  incident_code: string | null;
  incident_notes: string | null;
  proof_photo_url: string | null;
  source?: string | null;
  store_order_id?: string | null;
};

const ORDER_COLUMNS =
  "id, order_code, status, pickup_address, pickup_lat, pickup_lng, pickup_contact_name, pickup_contact_phone, drop_address, drop_lat, drop_lng, drop_contact_name, drop_contact_phone, package_description, weight_kg, distance_km, base_amount, extra_fee, commission_pct, incident_code, incident_notes, proof_photo_url, source, store_order_id";

export function riderEarning(o: Pick<CourierOrder, "base_amount" | "extra_fee" | "commission_pct">): number {
  const gross = Number(o.base_amount ?? 0) + Number(o.extra_fee ?? 0);
  const pct = Number(o.commission_pct ?? 0);
  return Math.round(gross * (100 - pct)) / 100;
}

export function mapsUrl(lat: number | null, lng: number | null, address?: string | null): string {
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address ?? "")}`;
}

/** True when the rider has an approved "Courier Delivery" skill. */
export function useCourierSkill(expertId: string | null | undefined) {
  return useQuery({
    queryKey: ["courier-skill", expertId],
    enabled: !!expertId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_skills")
        .select("id, status, service_categories(name)")
        .eq("expert_id", expertId!)
        .eq("status", "approved");
      if (error) throw error;
      return (data ?? []).some(
        (row) =>
          (row as { service_categories?: { name?: string | null } | null }).service_categories?.name ===
          COURIER_CATEGORY_NAME,
      );
    },
  });
}

/** Pending offers for this rider (server filters expiry + ownership). */
export function useCourierOffers(enabled: boolean) {
  return useQuery({
    queryKey: ["courier-offers"],
    enabled,
    // Offers expire in ~30s, so poll fast enough that a rider always sees them
    // even when the realtime socket is unavailable.
    refetchInterval: enabled ? 4_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("courier_rider_offers");
      if (error) throw error;
      return ((data ?? []) as unknown as CourierOffer[]).filter(
        (o) => new Date(o.expires_at).getTime() > Date.now(),
      );
    },
  });
}

/** Instant refresh when a new offer row lands for this rider. */
export function useCourierOfferRealtime(expertId: string | null | undefined, enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || !expertId) return;
    const ch = supabase
      .channel(`courier-offers-${expertId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "courier_offers", filter: `expert_id=eq.${expertId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["courier-offers"] });
          void qc.invalidateQueries({ queryKey: ["courier-active", expertId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [expertId, enabled, qc]);
}

/** The rider's current in-progress courier order, if any. */
export function useActiveCourierOrder(expertId: string | null | undefined) {
  return useQuery({
    queryKey: ["courier-active", expertId],
    enabled: !!expertId,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courier_orders")
        .select(ORDER_COLUMNS)
        .eq("assigned_expert_id", expertId!)
        .in("status", COURIER_ACTIVE_STATUSES as unknown as string[])
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as CourierOrder | null) ?? null;
    },
  });
}

export function useCourierOrder(orderId: string) {
  return useQuery({
    queryKey: ["courier-order", orderId],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courier_orders")
        .select(ORDER_COLUMNS)
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      return (data as CourierOrder | null) ?? null;
    },
  });
}

async function pushFix(): Promise<void> {
  const pos = await getFix();
  const { error } = await supabase.rpc("expert_update_location", {
    p_lat: pos.lat,
    p_lng: pos.lng,
  });
  if (error) throw error;
}

export async function getFix(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation not supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
  });
}

/**
 * While a courier job is active, push the rider's location every 15s (instead
 * of the usual 30s/60s cadence) and ask the native layer — when it supports it
 * — to switch to high-accuracy courier mode. Reverts on unmount / job end.
 */
export function useCourierLocationPing(active: boolean) {
  const busy = useRef(false);
  useEffect(() => {
    if (!active) return;
    void setNativeLocationMode("courier");
    const tick = () => {
      // Keep pinging even when backgrounded / screen locked — the rider is on a
      // bike with the phone in a pocket or Google Maps in front.
      if (busy.current) return;
      busy.current = true;
      pushFix()
        .catch((err) => console.warn("[courier] location ping failed", err))
        .finally(() => {
          busy.current = false;
        });
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      window.clearInterval(id);
      void setNativeLocationMode("normal");
    };
  }, [active]);
}

export const INCIDENT_CODES = [
  "consignee_unreachable",
  "wrong_address",
  "refused",
  "damaged",
  "accident",
] as const;
export type IncidentCode = (typeof INCIDENT_CODES)[number];
