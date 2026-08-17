import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { z } from "zod";
import badiyosWhite from "@/assets/badiyos-wordmark-white.png.asset.json";
import { expertApi } from "@/lib/expert-client";
import { supabase } from "@/integrations/supabase/client";
import { registerThisDevice } from "@/lib/devices";
import { useT } from "@/lib/i18n";

const searchSchema = z.object({
  phone: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
});

export const Route = createFileRoute("/otp")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Verify code — badiyos Partner" },
      { name: "description", content: "Enter the 4-digit code sent to your WhatsApp." },
    ],
  }),
  component: OtpScreen,
});

function OtpScreen() {
  const t = useT();
  const { phone } = Route.useSearch();
  const navigate = useNavigate();
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(30);
  const complete = digits.every((d) => d !== "");

  useEffect(() => {
    inputsRef.current[0]?.focus();
    if (!phone) navigate({ to: "/login" });
  }, [phone, navigate]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (!complete || loading || !phone) return;
    setLoading(true);
    setError(null);
    try {
      const { token_hash } = await expertApi.verifyOtp(phone, digits.join(""));
      const { error: vErr } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" });
      if (vErr) throw vErr;
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (uid) {
        const { data: exp } = await supabase
          .from("experts")
          .select("pin_hash")
          .eq("auth_user_id", uid)
          .maybeSingle();
        if (!exp?.pin_hash) {
          navigate({ to: "/set-pin", search: { phone } });
          return;
        }
      }
      const reg = await registerThisDevice().catch(() => ({ status: "registered" as const }));
      if (reg.status === "limit_reached") {
        navigate({ to: "/devices", search: { limit: "1" } });
        return;
      }
      navigate({ to: "/home" });
    } catch (err) {
      setError((err as Error).message ?? t("otp.failed"));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (resendIn > 0 || !phone) return;
    try {
      await expertApi.sendOtp(phone);
      setResendIn(30);
      setError(null);
    } catch (err) {
      setError((err as Error).message ?? t("otp.resendFailed"));
    }
  }

  const setAt = (i: number, val: string) => {
    const v = val.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
    if (v && i < 3) inputsRef.current[i + 1]?.focus();
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-card">
      {/* Gradient header */}
      <div className="relative flex shrink-0 flex-col items-center justify-center bg-gradient-to-b from-[#0058B0] to-[#0074E4] px-6 pb-10 pt-[max(var(--safe-top),1.5rem)] text-white">
        <img src={badiyosWhite.url} alt="badiyos" className="h-10 w-auto" />
        <p className="mt-3 text-center text-[15px] font-medium text-white/90">
          {t("otp.heading")}
        </p>
      </div>

      {/* White bottom-sheet card */}
      <div className="relative -mt-6 flex flex-1 flex-col rounded-t-[24px] bg-card px-6 pb-[max(env(safe-area-inset-bottom),2rem)] pt-8">
        <Link
          to="/login"
          className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
          aria-label={t("common.back")}
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>

        <h1 className="text-[24px] font-bold leading-tight text-foreground">{t("otp.title")}</h1>
        <p className="mt-1 text-[15px] text-[color:var(--text-secondary)]">
          {t("otp.sub")} <span className="font-semibold text-foreground">+91 {phone}</span>.
        </p>

        <form className="mt-8 flex flex-1 flex-col" onSubmit={verify}>
          <div className="flex items-center justify-between gap-3">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputsRef.current[i] = el; }}
                type="tel"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => setAt(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !digits[i] && i > 0) inputsRef.current[i - 1]?.focus();
                }}
                className="h-16 w-16 flex-1 rounded-[14px] border border-border bg-background text-center text-[26px] font-bold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            ))}
          </div>

          {error && <p className="mt-4 text-[13px] font-semibold text-[color:var(--color-destructive)]">{error}</p>}

          <button
            type="button"
            onClick={resend}
            disabled={resendIn > 0}
            className="mt-6 self-start text-[14px] font-semibold text-primary disabled:text-[color:var(--text-secondary)]"
          >
            {resendIn > 0 ? t("otp.resendIn", { seconds: resendIn }) : t("otp.resend")}
          </button>

          <div className="mt-auto pt-8">
            <button
              type="submit"
              disabled={!complete || loading}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)] transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
            >
              {loading && <Loader2 className="h-5 w-5 animate-spin" />}
              {loading ? t("otp.verifying") : t("otp.verify")}
            </button>
            <p className="mt-4 text-center text-[12px] leading-relaxed text-[color:var(--text-secondary)]">
              {t("legal.loginNote")}{" "}
              <Link to="/legal/$slug" params={{ slug: "terms" }} className="font-semibold text-primary underline">
                {t("legal.terms")}
              </Link>{" "}
              {t("legal.and")}{" "}
              <Link to="/legal/$slug" params={{ slug: "privacy-policy" }} className="font-semibold text-primary underline">
                {t("legal.privacy")}
              </Link>
              .
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
