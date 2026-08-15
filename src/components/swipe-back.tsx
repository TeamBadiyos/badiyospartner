import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { hapticImpact } from "@/lib/haptics";

const EDGE = 28; // px from left edge that arms the gesture
const COMMIT = 0.32; // fraction of screen width required to commit

/**
 * iOS-style edge-swipe-from-left to go back. Arms only when the touch starts
 * within the left edge strip, so it never competes with vertical scrolling or
 * horizontal swipe actions inside list items.
 *
 * `fallbackTo` is used when there is no previous entry in the router history
 * (e.g. the screen was opened from a push-notification deep link).
 */
export function SwipeBack({
  children,
  fallbackTo = "/home",
  disabled = false,
}: {
  children: ReactNode;
  fallbackTo?: string;
  disabled?: boolean;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const active = useRef(false);
  const decided = useRef(false);

  useEffect(() => {
    if (disabled) return;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE) return;
      active.current = true;
      decided.current = false;
      startX.current = t.clientX;
      startY.current = t.clientY;
      setAnimating(false);
    };

    const onMove = (e: TouchEvent) => {
      if (!active.current) return;
      const t = e.touches[0];
      const mx = t.clientX - startX.current;
      const my = t.clientY - startY.current;
      if (!decided.current) {
        if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 8) {
          active.current = false;
          setDx(0);
          return;
        }
        if (Math.abs(mx) < 8) return;
        decided.current = true;
      }
      if (e.cancelable) e.preventDefault();
      setDx(Math.max(0, mx));
    };

    const onEnd = () => {
      if (!active.current) return;
      active.current = false;
      const width = window.innerWidth || 1;
      const commit = dx / width >= COMMIT;
      setAnimating(true);
      if (commit) {
        hapticImpact("light");
        setDx(width);
        window.setTimeout(() => {
          if (router.history.canGoBack()) router.history.back();
          else void navigate({ to: fallbackTo });
        }, 160);
      } else {
        setDx(0);
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [dx, disabled, fallbackTo, navigate, router]);

  return (
    <div
      style={{
        transform: dx ? `translateX(${dx}px)` : undefined,
        transition: animating ? "transform 180ms ease-out" : "none",
        boxShadow: dx ? "-12px 0 32px -12px rgba(34,40,49,0.25)" : undefined,
        willChange: dx ? "transform" : undefined,
      }}
    >
      {children}
    </div>
  );
}
