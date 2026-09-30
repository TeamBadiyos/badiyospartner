import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlarmClock } from "lucide-react";
import { startNotificationLoop } from "@/lib/broadcast";
import { hapticNotification } from "@/lib/haptics";
import { useT, useLang } from "@/lib/i18n";
import { slotBadge } from "@/lib/slot-label";
import { serviceTitle } from "@/lib/service-pricing";

type Job = {
  id: string;
  service_label: string | null;
  service_duration_minutes: number | null;
  scheduled_date: string | null;
  scheduled_time_slot: string | null;
  status: string;
};

const WINDOW_MIN = 30;
const SEEN_KEY = "badiyo.expert.slotReminderSeen";

function seen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}
function markSeen(id: string) {
  try {
    const s = seen();
    s.add(id);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/**
 * Loud full-screen alert 30 minutes before a scheduled slot, while the app
 * is open. (Locked-screen ringing is handled by the Android layer.)
 */
export function SlotReminder({ jobs }: { jobs: Job[] }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [due, setDue] = useState<Job | null>(null);
  const soundRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    const check = () => {
      if (due) return;
      const now = Date.now();
      const hit = jobs.find((j) => {
        if (j.status !== "expert_assigned") return false;
        const badge = slotBadge(j, lang);
        if (!badge.start) return false;
        const diffMin = (badge.start.getTime() - now) / 60_000;
        return diffMin <= WINDOW_MIN && diffMin > 0 && !seen().has(j.id);
      });
      if (hit) setDue(hit);
    };
    check();
    const id = window.setInterval(check, 30_000);
    return () => window.clearInterval(id);
  }, [jobs, lang, due]);

  useEffect(() => {
    if (!due) return;
    hapticNotification("warning");
    soundRef.current = startNotificationLoop();
    return () => {
      soundRef.current?.stop();
      soundRef.current = null;
    };
  }, [due]);

  if (!due) return null;

  const badge = slotBadge(due, lang);
  const close = () => {
    soundRef.current?.stop();
    soundRef.current = null;
    markSeen(due.id);
    setDue(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0B1A2B] px-8 text-center">
      <div className="flex h-24 w-24 animate-pulse items-center justify-center rounded-full bg-[#F59E0B]">
        <AlarmClock className="h-12 w-12 text-[#1A1A1A]" strokeWidth={2.4} />
      </div>
      <p className="mt-6 text-[20px] font-extrabold text-[#F59E0B]">
        {t("reminder.minutes", { n: String(WINDOW_MIN) })}
      </p>
      <h1 className="mt-2 text-[32px] font-black leading-tight text-white">{badge.text}</h1>
      <p className="mt-3 text-[18px] font-bold text-white/80">
        {serviceTitle(due.service_label, due.service_duration_minutes ?? 60)}
      </p>

      <button
        onClick={() => {
          const id = due.id;
          close();
          navigate({ to: "/booking/$id", params: { id } });
        }}
        className="mt-10 h-[66px] w-full max-w-sm rounded-[18px] bg-[#059669] text-[20px] font-extrabold text-white active:scale-[0.98]"
      >
        {t("reminder.open")}
      </button>
      <button
        onClick={close}
        className="mt-3 h-[56px] w-full max-w-sm rounded-[18px] border border-white/25 text-[17px] font-bold text-white/85"
      >
        {t("reminder.ok")}
      </button>
    </div>
  );
}
