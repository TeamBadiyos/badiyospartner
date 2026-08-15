import { useRef, useState, type ReactNode } from "react";
import { hapticImpact } from "@/lib/haptics";

/**
 * Horizontal swipe-to-dismiss for notification-style cards.
 * Only used where a "Dismiss" affordance already exists in the UI, so the
 * gesture is an accelerator rather than a hidden-only action.
 */
export function SwipeToDismiss({
  onDismiss,
  children,
  className,
  direction = "both",
}: {
  onDismiss: () => void;
  children: ReactNode;
  className?: string;
  direction?: "left" | "right" | "both";
}) {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const decided = useRef<"h" | "v" | null>(null);

  const allow = (d: number) =>
    direction === "both" ? d : direction === "left" ? Math.min(0, d) : Math.max(0, d);

  return (
    <div
      className={className}
      style={{
        transform: dx ? `translateX(${dx}px)` : undefined,
        opacity: dx ? Math.max(0.25, 1 - Math.abs(dx) / 260) : 1,
        transition: animating ? "transform 180ms ease-out, opacity 180ms ease-out" : "none",
        touchAction: "pan-y",
      }}
      onTouchStart={(e) => {
        if (e.touches.length !== 1) return;
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        decided.current = null;
        setAnimating(false);
      }}
      onTouchMove={(e) => {
        if (!start.current) return;
        const mx = e.touches[0].clientX - start.current.x;
        const my = e.touches[0].clientY - start.current.y;
        if (!decided.current) {
          if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
          decided.current = Math.abs(mx) > Math.abs(my) ? "h" : "v";
        }
        if (decided.current !== "h") return;
        setDx(allow(mx));
      }}
      onTouchEnd={() => {
        start.current = null;
        if (decided.current !== "h") return;
        const threshold = Math.min(140, (window.innerWidth || 320) * 0.35);
        setAnimating(true);
        if (Math.abs(dx) >= threshold) {
          hapticImpact("medium");
          setDx(dx > 0 ? window.innerWidth : -window.innerWidth);
          window.setTimeout(onDismiss, 160);
        } else {
          setDx(0);
        }
      }}
    >
      {children}
    </div>
  );
}
