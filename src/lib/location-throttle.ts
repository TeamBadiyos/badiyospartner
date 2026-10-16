// Shared ping filter: skip if moved < 10 m AND last ping < 30 s ago.
const MIN_MOVE_M = 10;
const MIN_GAP_MS = 30_000;

let last: { lat: number; lng: number; at: number } | null = null;

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function shouldSkipPing(lat: number, lng: number, now = Date.now()): boolean {
  if (!last) return false;
  return distM(last, { lat, lng }) < MIN_MOVE_M && now - last.at < MIN_GAP_MS;
}

export function markPinged(lat: number, lng: number, now = Date.now()) {
  last = { lat, lng, at: now };
}
