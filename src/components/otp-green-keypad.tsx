import { Delete } from "lucide-react";
import { hapticImpact } from "@/lib/haptics";

/**
 * 4 large boxes with a thick GREEN border plus a big on-screen numeric keypad.
 * Used for both the start code and the end code, so both look identical.
 */
export function OtpGreenKeypad({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const digits = [0, 1, 2, 3].map((i) => value[i] ?? "");

  const press = (d: string) => {
    if (disabled || value.length >= 4) return;
    hapticImpact("light");
    onChange((value + d).slice(0, 4));
  };
  const back = () => {
    if (disabled || value.length === 0) return;
    hapticImpact("light");
    onChange(value.slice(0, -1));
  };

  return (
    <div>
      <div className="grid grid-cols-4 gap-3">
        {digits.map((d, i) => (
          <div
            key={i}
            className={`flex h-[74px] w-full items-center justify-center rounded-[16px] border-[3px] bg-[#ECFDF5] text-[36px] font-black leading-none text-[#065F46] ${
              i === value.length && !disabled
                ? "border-[#059669] ring-4 ring-[#05966933]"
                : "border-[#10B981]"
            }`}
          >
            {d || <span className="text-[#10B981]/40">–</span>}
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => press(k)}
            className="h-[62px] rounded-[16px] border border-border bg-card text-[28px] font-bold text-foreground active:scale-95 active:bg-muted disabled:opacity-40"
          >
            {k}
          </button>
        ))}
        <div />
        <button
          type="button"
          disabled={disabled}
          onClick={() => press("0")}
          className="h-[62px] rounded-[16px] border border-border bg-card text-[28px] font-bold text-foreground active:scale-95 active:bg-muted disabled:opacity-40"
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={back}
          aria-label="Delete"
          className="flex h-[62px] items-center justify-center rounded-[16px] border border-border bg-card text-foreground active:scale-95 active:bg-muted disabled:opacity-40"
        >
          <Delete className="h-7 w-7" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
