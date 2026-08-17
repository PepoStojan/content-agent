import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Design V1 project workspace tab. Locked tabs show a padlock, a
 * tooltip explaining why, and their click is a no-op — enforced by
 * the caller passing a no-op onClick when locked, not by this
 * component guessing at behavior.
 *
 * Locking must always be driven by the same source of truth as the
 * Settings "strict approval gate" flag (see engineering spec) —
 * never hardcode a locked state here.
 */
function LockedTab({
  className,
  label,
  active,
  locked,
  onClick,
}: {
  label: string;
  active?: boolean;
  locked?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-slot="locked-tab"
      onClick={locked ? undefined : onClick}
      title={locked ? "Locked until the previous step is approved" : undefined}
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 font-sans text-[13.5px] font-semibold",
        locked
          ? "cursor-default border-transparent text-text-muted"
          : active
            ? "border-primary text-primary"
            : "border-transparent text-text-secondary hover:text-text-primary",
        className
      )}
    >
      {locked ? <Lock className="size-[11px]" /> : null}
      {label}
    </button>
  );
}

export { LockedTab };
