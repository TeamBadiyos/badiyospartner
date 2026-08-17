import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { hapticImpact } from "@/lib/haptics";

const THRESHOLD = 72;
const MAX_PULL = 120;

/**
 * Native-style pull-to-refresh. Wraps a scrollable screen; the page itself
 * scrolls on the window, so the gesture only engages when already at the top.
 * The browser's own pull-to-refresh is disabled globally via
 * `overscroll-behavior-y: none` in styles.css.
 */
export function PullToRefresh({
  onRefresh,
  children,
  className,
}: {
  onRefresh: () => Promise<unknown> | unknown;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const run = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setPull(THRESHOLD);
    hapticImpact("light");
    try {
      await onRefresh();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setPull(0);
    }
  }, [onRefresh]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const atTop = () => window.scrollY <= 0;

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1 || !atTop()) return;
      startY.current = e.touches[0].clientY;
      armed.current = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!armed.current || startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || !atTop()) {
        setPull(0);
        return;
      }
      // Rubber-band resistance
      const dist = Math.min(MAX_PULL, dy * 0.5);
      if (dist > 4 && e.cancelable) e.preventDefault();
      setPull(dist);
    };

    const onEnd = () => {
      if (!armed.current) return;
      armed.current = false;
      startY.current = null;
      setPull((d) => {
        if (d >= THRESHOLD) void run();
        return d >= THRESHOLD ? d : 0;
      });
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [run]);

  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div ref={ref} className={className}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center"
        style={{
          transform: `translateY(${Math.max(0, pull - 36)}px)`,
          opacity: progress,
          transition: pull === 0 || refreshing ? "transform 220ms ease, opacity 220ms ease" : "none",
        }}
      >
        <div className="mt-[var(--safe-top)] flex h-9 w-9 items-center justify-center rounded-full bg-card shadow-[var(--shadow-card)] ring-1 ring-border">
          <Loader2
            className={`h-4 w-4 text-primary ${refreshing ? "animate-spin" : ""}`}
            style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
        </div>
      </div>
      <div
        style={{
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: pull === 0 || refreshing ? "transform 220ms ease" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
