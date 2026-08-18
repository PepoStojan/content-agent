import {
  PIPELINE_STAGES,
  pipelineStageForState,
  type GenerationState,
  type PipelineStage,
} from "@/lib/generation/state-machine";
import { cn } from "@/lib/utils";

const STAGE_LABEL: Record<PipelineStage, string> = {
  draft: "Draft",
  strategy: "Strategy",
  blueprint: "Blueprint",
  content: "Content",
  qa: "QA",
  export: "Export",
};

/**
 * Phase 4.1 addition — Design V1 has no vertical pipeline progress
 * view (its Project Workspace uses the horizontal tab bar instead,
 * which stays as-is). This is new, additive surface area showing the
 * finer-grained generation_state, not a replacement for the tabs.
 * Purely visual: reads state, renders it, triggers nothing.
 */
export function GenerationProgress({ state }: { state: GenerationState }) {
  const currentStage = pipelineStageForState(state);
  const currentIndex = PIPELINE_STAGES.indexOf(currentStage);
  const failed = state === "failed";

  return (
    <div className="flex flex-col" data-slot="generation-progress">
      {PIPELINE_STAGES.map((stage, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const isLast = i === PIPELINE_STAGES.length - 1;

        return (
          <div key={stage} className="flex flex-col">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-pill text-[11px] font-bold",
                  failed && active
                    ? "bg-status-danger-bg text-status-danger-fg"
                    : done
                      ? "bg-primary text-primary-foreground"
                      : active
                        ? "border-2 border-primary text-primary"
                        : "bg-secondary text-text-muted"
                )}
              >
                {failed && active ? "!" : done ? "✓" : i + 1}
              </span>
              <span
                className={cn(
                  "text-sm",
                  active ? "font-semibold text-text-primary" : done ? "text-text-primary" : "text-text-muted"
                )}
              >
                {STAGE_LABEL[stage]}
              </span>
            </div>
            {!isLast ? <div className="ml-3 h-4 w-px bg-border" /> : null}
          </div>
        );
      })}
    </div>
  );
}
