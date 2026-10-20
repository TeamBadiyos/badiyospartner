import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

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
      let saved = hasSavedSession();
      if (!saved) {
        try {
          const { data } = await supabase.auth.getSession();
          saved = !!data.session;
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
        if (error?.status === 401 || error?.status === 403 || (!error && !data?.user)) {
          await supabase.auth.signOut({ scope: "local" });
          navigate({ to: "/login", replace: true });
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
