import { cn } from "@/lib/utils";

/**
 * Design V1 card: white surface, 1px border, 16px radius, no drop shadow.
 * Elevation comes from surface color and border only.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-card border border-border bg-card p-4 sm:p-5",
        className
      )}
      {...props}
    />
  );
}

export { Card };
