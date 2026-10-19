const STORAGE_BASE = "https://api.badiyos.com/storage/v1/object/public/expert-photos/";

/** Turns stored photo paths (e.g. "photos/<id>.jpg") into a loadable URL. */
export function resolveExpertPhoto(url: string | null | undefined): string | null {
  const v = (url ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return STORAGE_BASE + v.replace(/^\/+/, "").replace(/^expert-photos\//, "");
}
