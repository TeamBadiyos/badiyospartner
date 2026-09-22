// Supabase API endpoint for this app.
//
// The project is served from the verified custom domain https://api.badiyos.com
// (the original dkneclwmmjlqswovtqno.supabase.co host keeps working too). Some
// mobile/WiFi networks block or mis-resolve *.supabase.co, which made login
// fail, so all browser-side traffic goes through the custom domain.
//
// IMPORTANT: supabase-js derives its auth storage key from the URL hostname
// (`sb-<first-label>-auth-token`). On the custom domain that would become
// `sb-api-auth-token` and every signed-in expert would be logged out, and the
// native Android services (SupabaseRpc.java / BackgroundAvailabilityService.java)
// read the old key. So the storage key is pinned to the project-ref form below.
export const SUPABASE_API_URL = "https://api.badiyos.com";

export const SUPABASE_AUTH_STORAGE_KEY = "sb-dkneclwmmjlqswovtqno-auth-token";
