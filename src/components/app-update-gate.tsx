import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_URL = "https://play.google.com/store/apps/details?id=com.badiyos.expert";

type State = { blocked: boolean; url: string; latest: string | null };

/** Native build number on Android; null on web (web is never blocked). */
async function nativeBuild(): Promise<number | null> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    const code = Number.parseInt(String(info.build ?? ""), 10);
    return Number.isFinite(code) && code > 0 ? code : null;
  } catch {
    return null;
  }
}

/** Compulsory update: blocks the whole app when the installed build is below the minimum. */
export function AppUpdateGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ blocked: false, url: DEFAULT_URL, latest: null });
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const build = await nativeBuild();
      if (build == null) return setState((s) => ({ ...s, blocked: false }));
      const { data } = await supabase
        .from("app_config")
        .select("expert_min_version_code, expert_latest_version, expert_play_store_url")
        .eq("id", 1)
        .maybeSingle();
      if (!data) return; // offline / error: never block on missing info
      setState({
        blocked: build < (data.expert_min_version_code ?? 1),
        url: data.expert_play_store_url || DEFAULT_URL,
        latest: data.expert_latest_version ?? null,
      });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    let remove: (() => void) | undefined;
    void import("@capacitor/app")
      .then(async ({ App }) => {
        const h = await App.addListener("appStateChange", (s) => s.isActive && void check());
        remove = () => void h.remove();
      })
      .catch(() => {});
    return () => remove?.();
  }, [check]);

  // Hardware back on the blocking screen exits the app instead of bypassing it.
  useEffect(() => {
    if (!state.blocked) return;
    let remove: (() => void) | undefined;
    void import("@capacitor/app")
      .then(async ({ App }) => {
        const h = await App.addListener("backButton", () => void App.exitApp());
        remove = () => void h.remove();
      })
      .catch(() => {});
    return () => remove?.();
  }, [state.blocked]);

  if (!state.blocked) return <>{children}</>;

  const marketUrl = state.url.replace(/^https:\/\/play\.google\.com\/store\/apps\//, "market://");
  const openStore = () => {
    try {
      window.location.href = marketUrl;
      setTimeout(() => window.open(state.url, "_system"), 800);
    } catch {
      window.open(state.url, "_system");
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-4xl">⬆️</div>
      <h1 className="text-2xl font-extrabold text-foreground">
        नवीन अपडेट आवश्यक आहे
        <span className="mt-1 block text-lg font-bold text-muted-foreground">Update required</span>
      </h1>
      <p className="max-w-sm text-base text-muted-foreground">
        नवीन काम आणि अलर्ट मिळवण्यासाठी कृपया ॲप अपडेट करा.
        <br />
        Please update badiyos Expert to keep getting jobs and alerts.
        {state.latest ? <span className="mt-2 block font-semibold text-foreground">v{state.latest}</span> : null}
      </p>
      <button
        onClick={openStore}
        className="w-full max-w-sm rounded-2xl bg-primary py-4 text-lg font-bold text-primary-foreground"
      >
        आता अपडेट करा / Update now
      </button>
      <button
        onClick={() => void check()}
        disabled={checking}
        className="w-full max-w-sm rounded-2xl border border-input py-3 font-semibold text-foreground disabled:opacity-60"
      >
        {checking ? "तपासत आहे… / Checking…" : "पुन्हा तपासा / Check again"}
      </button>
    </div>
  );
}
