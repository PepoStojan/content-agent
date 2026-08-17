import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Design V1 status badge: pill, colored bg/text pair.
 * Tones map to the fixed status tints in the frozen palette — do not
 * add new tones without a design decision.
 */
const statusBadgeVariants = cva(
  "inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        waiting: "bg-status-waiting-bg text-status-waiting-fg",
        progress: "bg-status-progress-bg text-status-progress-fg",
        success: "bg-status-success-bg text-status-success-fg",
        warning: "bg-status-warning-bg text-status-warning-fg",
        danger: "bg-status-danger-bg text-status-danger-fg",
        neutral: "bg-secondary text-secondary-foreground",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
);

interface StatusBadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof statusBadgeVariants> {}

function StatusBadge({ className, tone, ...props }: StatusBadgeProps) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ tone, className }))}
      {...props}
    />
  );
}

export { StatusBadge, statusBadgeVariants };
