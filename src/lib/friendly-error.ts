// Turns raw backend/network errors into short, human messages so no button
// ever fails silently or shows a cryptic code.
export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw =
    (err as { message?: string })?.message ??
    (typeof err === "string" ? err : "") ??
    "";
  const msg = String(raw);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "No internet connection. Please check your network and try again.";
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
    return "Could not reach the server. Check your internet and try again.";
  }
  if (/service_closed/i.test(msg)) {
    return msg.replace(/^.*service_closed[:\s]*/i, "") || "Service is closed right now.";
  }
  if (/not_registered|not an expert/i.test(msg)) return "This number is not registered as a badiyos Expert.";
  if (/not authenticated|jwt|unauthorized|401/i.test(msg)) return "Your session expired. Please sign in again.";
  if (/kyc|not approved|pending approval/i.test(msg)) return "Your account is not approved yet. Please contact support.";
  if (/outside.*zone|zone/i.test(msg) && /outside|not in/i.test(msg)) return "You are outside your service zone.";
  if (/permission denied|row-level security|42501/i.test(msg)) return "You don't have permission to do this.";
  if (/timed out|timeout/i.test(msg)) return "This took too long. Please try again.";
  if (/^request failed: 5\d\d/i.test(msg)) return "Server error. Please try again in a moment.";
  return msg && msg.length < 160 ? msg : fallback;
}
