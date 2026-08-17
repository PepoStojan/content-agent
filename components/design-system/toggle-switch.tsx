import { cn } from "@/lib/utils";

/**
 * Design V1 toggle switch (Settings feature flags).
 * The "strict approval gate" instance of this must read/write the
 * same setting the tab-locking logic reads — never a separate copy.
 */
function ToggleSwitch({
  className,
  checked,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<"button">, "onClick"> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="toggle-switch"
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors",
        checked ? "bg-primary" : "bg-border",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "absolute top-0.5 size-[18px] rounded-pill bg-card transition-[left]",
          checked ? "left-[18px]" : "left-0.5"
        )}
      />
    </button>
  );
}

export { ToggleSwitch };
