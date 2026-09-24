import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Stop = { id: string; order_id: string; stop_type: string; sequence: number; lat: number | null; lng: number | null };

function haversineKm(a: Stop, b: Stop): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function routeKm(a: Stop, b: Stop, key: string | undefined): Promise<number> {
  const fallback = () => Math.round(haversineKm(a, b) * 1.3 * 100) / 100;
  if (!key || a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
    console.warn("[returns] Routes API unavailable, using haversine x1.3", { from: a.id, to: b.id });
    return fallback();
  }
  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
        destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
        travelMode: "TWO_WHEELER",
      }),
    });
    const json = (await res.json()) as { routes?: { distanceMeters?: number }[] };
    const m = json.routes?.[0]?.distanceMeters;
    if (!res.ok || m == null) throw new Error(`Routes API ${res.status}`);
    return Math.round((m / 1000) * 100) / 100;
  } catch (err) {
    console.warn("[returns] Routes API failed, using haversine x1.3", err);
    return fallback();
  }
}

export const computeReturnDistances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ order_id: z.string().uuid(), failing_stop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as { from: (t: string) => any; rpc: (f: string, a?: object) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: expertId } = await sb.rpc("get_expert_id_for_auth", { _auth_user_id: context.userId }).catch(() => ({ data: null }));
    const { data: order } = await sb.from("courier_orders").select("id, assigned_expert_id").eq("id", data.order_id).maybeSingle();
    if (!order || (expertId && order.assigned_expert_id !== expertId) || (!expertId && !order.assigned_expert_id)) {
      throw new Error("Forbidden");
    }
    // RLS lets only the assigned rider read the order; double-check via experts row.
    const { data: me } = await sb.from("experts").select("id").eq("auth_user_id", context.userId).maybeSingle();
    if (!me || me.id !== order.assigned_expert_id) throw new Error("Forbidden");

    const [{ data: stops }, { data: parcels }] = await Promise.all([
      sb.from("courier_order_stops").select("id, order_id, stop_type, sequence, lat, lng").eq("order_id", data.order_id).order("sequence"),
      sb.from("courier_order_parcels").select("pickup_stop_id, drop_stop_id").eq("order_id", data.order_id),
    ]);
    const all = (stops ?? []) as Stop[];
    const drops = all.filter((s) => s.stop_type === "drop");
    const lastDrop = drops[drops.length - 1];
    const pickupIds = new Set(
      ((parcels ?? []) as { pickup_stop_id: string; drop_stop_id: string }[])
        .filter((p) => p.drop_stop_id === data.failing_stop_id)
        .map((p) => p.pickup_stop_id),
    );
    const pickups = all.filter((s) => s.stop_type === "pickup" && pickupIds.has(s.id));
    const key = process.env["GOOGLE_MAPS_SERVER_KEY"];
    const out: Record<string, number> = {};
    let from = lastDrop;
    for (const p of pickups) {
      out[p.id] = from ? await routeKm(from, p, key) : 0;
      from = p;
    }
    return out;
  });

export const getCourierFailWaitMinutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await (supabaseAdmin as unknown as { rpc: (f: string, a: object) => Promise<{ data: unknown }> }).rpc(
        "courier_setting",
        { _key: "courier_fail_wait_minutes", _default: 10 },
      );
      const n = Number(data);
      return Number.isFinite(n) && n >= 0 ? n : 10;
    } catch {
      return 10;
    }
  });
