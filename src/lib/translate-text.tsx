import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

/**
 * Auto-translates dynamic customer data (names, addresses, notes) into Marathi
 * when the expert's language is "mr". Shows the original text instantly and
 * swaps in the translation when ready. Results are cached on the device.
 */
const CACHE_KEY = "badiyo.expert.trCache.mr";
const inflight = new Map<string, Promise<string | null>>();
let mem: Record<string, string> | null = null;

function cache(): Record<string, string> {
  if (mem) return mem;
  try {
    mem = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    mem = {};
  }
  return mem!;
}

function save(src: string, out: string) {
  const c = cache();
  c[src] = out;
  const keys = Object.keys(c);
  if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete c[k];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage full — ignore */
  }
}

// Already contains Devanagari → nothing to translate.
const hasDevanagari = (s: string) => /[\u0900-\u097F]/.test(s);
const hasLatin = (s: string) => /[A-Za-z]/.test(s);

function fetchMr(src: string): Promise<string | null> {
  const existing = inflight.get(src);
  if (existing) return existing;
  const p = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(src)}&langpair=en|mr`,
        { signal: ctrl.signal },
      );
      clearTimeout(timer);
      if (!res.ok) return null;
      const j = await res.json();
      const out: string | undefined = j?.responseData?.translatedText;
      if (!out || !hasDevanagari(out) || /MYMEMORY WARNING|QUERY LENGTH/i.test(out)) return null;
      save(src, out);
      return out;
    } catch {
      return null;
    } finally {
      inflight.delete(src);
    }
  })();
  inflight.set(src, p);
  return p;
}

export function useTranslatedText(text: string | null | undefined): string | null | undefined {
  const lang = useLang();
  const [out, setOut] = useState(text);
  useEffect(() => {
    setOut(text);
    if (lang !== "mr" || !text) return;
    const src = text.trim();
    if (!src || src.length > 480 || !hasLatin(src) || hasDevanagari(src)) return;
    const hit = cache()[src];
    if (hit) {
      setOut(hit);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    let alive = true;
    void fetchMr(src).then((r) => {
      if (alive && r) setOut(r);
    });
    return () => {
      alive = false;
    };
  }, [text, lang]);
  return out;
}

/** Inline helper: <Tr text={address} fallback="—" /> */
export function Tr({ text, fallback = "" }: { text: string | null | undefined; fallback?: string }) {
  const v = useTranslatedText(text);
  return <>{v || fallback}</>;
}
