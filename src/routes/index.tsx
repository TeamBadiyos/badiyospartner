import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import badiyosWhite from "@/assets/badiyos-wordmark-white.png.asset.json";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Splash,
});

function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    (async () => {
      let hasSession = false;
      try {
        // Never let a hung/failed session lookup strand the splash screen.
        const { data } = (await Promise.race([
          supabase.auth.getSession(),
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: { session: null } }), 6000),
          ),
        ])) as { data: { session: unknown } };
        hasSession = !!data?.session;
      } catch (err) {
        console.warn("[splash] getSession failed", err);
      }
      const elapsed = Date.now() - start;
      const wait = Math.max(0, 1200 - elapsed);
      setTimeout(() => {
        if (cancelled) return;
        try {
          navigate({ to: hasSession ? "/home" : "/login", replace: true });
        } catch {
          navigate({ to: "/login", replace: true });
        }
      }, wait);
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center px-8"
      style={{ backgroundColor: "#0074E4" }}
    >
      <img
        src={badiyosWhite.url}
        alt="badiyos"
        className="w-56 max-w-[70%] animate-pulse"
      />
      <p className="mt-4 text-lg font-semibold tracking-wide text-white/90">
        Expert
      </p>
    </div>
  );
}
