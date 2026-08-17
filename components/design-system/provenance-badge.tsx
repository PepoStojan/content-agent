import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Design V1 provenance badge (protected — see design_handoff README
 * "Approval & Provenance Rules"). Exactly four variants; every
 * research/AI/user/system-sourced value on screen must carry one.
 * Do not add a fifth variant or change these colors without asking.
 */
const provenanceBadgeVariants = cva(
  "inline-flex items-center rounded-[6px] px-2 py-[3px] text-[10px] font-bold tracking-[0.03em] uppercase whitespace-nowrap",
  {
    variants: {
      source: {
        research: "bg-provenance-research-bg text-provenance-research-fg",
        ai: "bg-provenance-ai-bg text-provenance-ai-fg",
        user: "bg-provenance-user-bg text-provenance-user-fg",
        system: "bg-provenance-system-bg text-provenance-system-fg",
      },
    },
  }
);

const provenanceLabel: Record<
  NonNullable<VariantProps<typeof provenanceBadgeVariants>["source"]>,
  string
> = {
  research: "Research finding",
  ai: "AI recommendation",
  user: "User decision",
  system: "System validation",
};

interface ProvenanceBadgeProps
  extends Omit<React.ComponentProps<"span">, "children">,
    VariantProps<typeof provenanceBadgeVariants> {
  source: NonNullable<VariantProps<typeof provenanceBadgeVariants>["source"]>;
  /** Override the default label, e.g. "AI recommendation · editable" */
  label?: string;
}

function ProvenanceBadge({
  className,
  source,
  label,
  ...props
}: ProvenanceBadgeProps) {
  return (
    <span
      data-slot="provenance-badge"
      className={cn(provenanceBadgeVariants({ source, className }))}
      {...props}
    >
      {label ?? provenanceLabel[source]}
    </span>
  );
}

export { ProvenanceBadge, provenanceBadgeVariants, provenanceLabel };
