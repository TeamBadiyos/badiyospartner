import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase, refreshAccessTokenOnce, signOutToLogin } from "@/integrations/supabase/client";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/integrations/supabase/api-url";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "badiyos Expert — Service provider access" },
      { name: "description", content: "Open the badiyos Expert app to manage your work." },
      { property: "og:title", content: "badiyos Expert — Service provider access" },
      { property: "og:description", content: "Open the badiyos Expert app to manage your work." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Splash,
});

/** Instant check: is a Supabase session saved on this device? */
function hasSavedSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
        const v = localStorage.getItem(k);
        if (v && v.includes("refresh_token")) return true;
      }
    }
  } catch {
    /* storage unavailable */
  }
  return false;
}

function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // On the phone app the login is kept in the phone's own storage (not
      // localStorage), so read it from there; it is local, no network wait.
      // Read the stored value directly — getSession() can wait on a network
      // token refresh, which kept the blue screen up for seconds.
      let saved = hasSavedSession();
      if (!saved) {
        try {
          const { Capacitor } = await import("@capacitor/core");
          if (Capacitor.isNativePlatform()) {
            const { Preferences } = await import("@capacitor/preferences");
            const { value } = await Preferences.get({ key: SUPABASE_AUTH_STORAGE_KEY });
            saved = !!value && value.includes("refresh_token");
          }
        } catch {
          saved = false;
        }
      }
      if (cancelled) return;
      navigate({ to: saved ? "/home" : "/login", replace: true });
      if (!saved) return;
      // Validate in the background; only a definitely-invalid session logs out.
      try {
        const { data, error } = await supabase.auth.getUser();
        const jwtError =
          error?.status === 401 || error?.status === 403 || /jwt/i.test(error?.message ?? "");
        if (jwtError || (!error && !data?.user)) {
          // Try a silent refresh first; only log out if that fails too.
          const token = await refreshAccessTokenOnce();
          if (!token) await signOutToLogin();
        }
      } catch {
        /* offline — keep the saved session */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Plain background matching the native splash; shown for a frame at most.
  return <div className="min-h-[100dvh]" style={{ backgroundColor: "#0074E4" }} />;
}
