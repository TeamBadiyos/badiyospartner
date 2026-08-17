import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Phone, Loader2 } from "lucide-react";
import badiyosWhite from "@/assets/badiyos-wordmark-white.png.asset.json";
import { expertApi } from "@/lib/expert-client";
import { useLanguage, useT, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — badiyos Partner" },
      { name: "description", content: "Sign in to badiyos Partner with your registered mobile number." },
    ],
  }),
  component: LoginScreen,
});

function LoginScreen() {
  const t = useT();
  const { lang, setLang } = useLanguage();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const digits = phone.replace(/\D/g, "").slice(-10);
  const valid = digits.length === 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    try {
      try {
        const { has_pin } = await expertApi.checkPin(digits);
        if (has_pin) {
          navigate({ to: "/pin", search: { phone: digits } });
          return;
        }
      } catch {
        // Fall back to OTP flow if the check fails.
      }
      await expertApi.sendOtp(digits);
      navigate({ to: "/otp", search: { phone: digits } });
    } catch (err) {
      const msg = (err as Error).message ?? t("login.failed");
      if (msg.includes("NOT_REGISTERED")) {
        navigate({ to: "/not-registered" });
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function chooseLanguage(next: Lang) {
    if (next === lang) return;
    try {
      await setLang(next);
    } catch {
      // Pre-login: RPC may fail without session, but local storage is already updated.
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-card">
      {/* Gradient header */}
      <div className="relative flex shrink-0 flex-col items-center justify-center bg-gradient-to-b from-[#0058B0] to-[#0074E4] px-6 pb-10 pt-[max(var(--safe-top),1.5rem)] text-white">
        <div className="absolute right-4 top-[max(var(--safe-top),1rem)]">
          <div className="flex rounded-full border border-white/20 bg-white/10 p-1 backdrop-blur-sm">
            {(["en", "mr"] as Lang[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => chooseLanguage(code)}
                className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide rounded-full transition ${
                  lang === code ? "bg-white text-[#0074E4]" : "text-white/80 hover:text-white"
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        <img src={badiyosWhite.url} alt="badiyos" className="h-10 w-auto" />
        <p className="mt-3 text-center text-[15px] font-medium text-white/90">
          {t("login.tagline")}
        </p>
      </div>

      {/* White bottom-sheet card */}
      <div className="relative -mt-6 flex flex-1 flex-col rounded-t-[24px] bg-card px-6 pb-[max(env(safe-area-inset-bottom),2rem)] pt-8">
        <h1 className="text-[24px] font-bold leading-tight text-foreground">
          {t("login.heading")}
        </h1>
        <p className="mt-1 text-[15px] text-[color:var(--text-secondary)]">
          {t("login.subheading")}
        </p>

        <form className="mt-6 flex flex-1 flex-col" onSubmit={submit}>
          <label className="text-[13px] font-semibold text-foreground">{t("login.label")}</label>
          <div className="mt-2 flex h-[52px] items-center gap-2 rounded-[14px] border border-border bg-background px-4 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <Phone className="h-5 w-5 text-[color:var(--text-secondary)]" strokeWidth={2} />
            <span className="text-[15px] font-semibold text-foreground">+91</span>
            <div className="h-6 w-px bg-[color:var(--color-divider)]" />
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder={t("login.placeholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
              className="flex-1 bg-transparent text-[16px] font-medium text-foreground outline-none placeholder:text-[color:var(--text-secondary)]/60"
            />
          </div>

          {error && (
            <p className="mt-3 text-[13px] font-semibold text-[color:var(--color-destructive)]">
              {error}
            </p>
          )}

          <div className="mt-auto pt-8">
            <button
              type="submit"
              disabled={!valid || loading}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)] transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
            >
              {loading && <Loader2 className="h-5 w-5 animate-spin" />}
              {loading ? t("login.sending") : t("login.send")}
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
