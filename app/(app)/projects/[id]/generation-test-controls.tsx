"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { transitionGenerationState } from "@/lib/generation/actions";
import { GENERATION_STATE_ORDER, nextStates, type GenerationState } from "@/lib/generation/state-machine";

/**
 * TEMPORARY, Phase 4.1 only. No real generation stage exists yet to
 * drive generation_state, so this manual control is how the state
 * machine + generation_events logging get exercised/verified in the
 * browser. Remove this file and its usage once Phase 4.2 wires real
 * stage triggers (Strategy/Blueprint/Content/QA/Export generation)
 * that call transitionGenerationState() themselves.
 */
export function GenerationTestControls({
  projectId,
  state,
}: {
  projectId: string;
  state: GenerationState;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = nextStates(state).filter((s) => GENERATION_STATE_ORDER.includes(s) || s === "failed");

  async function advance(to: GenerationState) {
    setPending(true);
    setError(null);
    try {
      await transitionGenerationState(projectId, to, `test_advance_to_${to}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed.");
    } finally {
      setPending(false);
    }
  }

  if (options.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-panel border border-dashed border-border p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        Dev test control — Phase 4.1 only
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((s) => (
          <Button key={s} variant="outline" disabled={pending} onClick={() => advance(s)}>
            → {s}
          </Button>
        ))}
      </div>
      {error ? <div className="text-xs text-status-danger-fg">{error}</div> : null}
    </div>
  );
}
