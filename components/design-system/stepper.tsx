import { cn } from "@/lib/utils";

/**
 * Design V1 wizard stepper: numbered dots + label, horizontally
 * scrollable, labels hidden below the mobile breakpoint (dots only).
 */
function Stepper({
  className,
  steps,
  currentIndex,
}: {
  steps: { label: string }[];
  currentIndex: number;
  className?: string;
}) {
  return (
    <div
      data-slot="stepper"
      className={cn(
        "flex gap-0 overflow-x-auto border-b border-border",
        className
      )}
    >
      {steps.map((step, i) => {
        const active = i === currentIndex;
        const done = i < currentIndex;
        return (
          <div
            key={step.label}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 py-3 pr-5 font-sans text-[12.5px] font-semibold whitespace-nowrap",
              active ? "border-primary text-text-primary" : "border-transparent text-text-muted"
            )}
          >
            <span
              className={cn(
                "inline-flex size-[18px] items-center justify-center rounded-pill text-[10px] font-bold",
                active || done
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-text-muted"
              )}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className="hidden sm:inline">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export { Stepper };
