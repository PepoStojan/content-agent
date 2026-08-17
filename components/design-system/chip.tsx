import { cn } from "@/lib/utils";

/**
 * Design V1 chip: selectable pill, teal border+bg when selected.
 * Used for content type, business profile, and brand voice selection
 * in the New Content wizard.
 */
function Chip({
  className,
  selected,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      data-slot="chip"
      aria-pressed={selected}
      className={cn(
        "rounded-[10px] border px-3.5 py-2 font-sans text-[13px] transition-colors",
        selected
          ? "border-primary bg-status-success-bg text-status-success-fg"
          : "border-border bg-card text-text-secondary hover:border-primary/40",
        className
      )}
      {...props}
    />
  );
}

export { Chip };
