import { cn } from "@/lib/utils";

/**
 * Section heading with a small blue accent bar, matching the Customer App's
 * SectionHeading pattern (adapted to the Partner App's blue brand).
 */
export function SectionHeading({
  children,
  className,
  size = "md",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "md" | "sm";
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span aria-hidden className="h-4 w-[3px] rounded-full bg-primary" />
      <h2
        className={cn(
          size === "sm"
            ? "text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
            : "text-[16px] font-bold tracking-[-0.01em] text-foreground",
        )}
      >
        {children}
      </h2>
    </div>
  );
}
