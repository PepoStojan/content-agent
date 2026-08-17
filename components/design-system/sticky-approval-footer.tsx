import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Design V1 sticky approval footer for Brief/Blueprint tabs.
 * Only rendered while the current version is un-approved; once
 * approved it is replaced by the "approved" banner, not shown
 * alongside it.
 */
function StickyApprovalFooter({
  className,
  approveLabel,
  onRequestChanges,
  onApprove,
}: {
  approveLabel: string;
  onRequestChanges?: () => void;
  onApprove?: () => void;
  className?: string;
}) {
  return (
    <div
      data-slot="sticky-approval-footer"
      className={cn(
        "sticky bottom-0 flex justify-end gap-2.5 border-t border-border bg-card px-10 py-3.5",
        className
      )}
    >
      <Button variant="outline" onClick={onRequestChanges}>
        Request changes
      </Button>
      <Button onClick={onApprove}>{approveLabel}</Button>
    </div>
  );
}

export { StickyApprovalFooter };
