"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import { Chip } from "@/components/design-system/chip";
import { ProvenanceBadge } from "@/components/design-system/provenance-badge";
import { StatusBadge } from "@/components/design-system/status-badge";
import { Stepper } from "@/components/design-system/stepper";
import { ToggleSwitch } from "@/components/design-system/toggle-switch";

/**
 * Phase 0 placeholder, unchanged in Phase 1 beyond being extracted out
 * of app/page.tsx so the page itself could become a server component.
 * Still just confirms tokens/components render — no product screens.
 */
export function DesignSystemPreview() {
  const [gateEnabled, setGateEnabled] = useState(true);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button>Primary action</Button>
        <Button variant="outline">Secondary</Button>
        <Button variant="destructive">Destructive</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="waiting">Waiting for approval</StatusBadge>
        <StatusBadge tone="progress">In progress</StatusBadge>
        <StatusBadge tone="success">Exported</StatusBadge>
        <StatusBadge tone="danger">QA failed</StatusBadge>
      </div>

      <div className="flex flex-wrap gap-2">
        <ProvenanceBadge source="research" />
        <ProvenanceBadge source="ai" />
        <ProvenanceBadge source="user" />
        <ProvenanceBadge source="system" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip selected>Blog post</Chip>
        <Chip>Landing page</Chip>
        <Chip>Comparison page</Chip>
        <Chip>Guide</Chip>
      </div>

      <Stepper
        steps={[
          { label: "Basics" },
          { label: "Research" },
          { label: "Website knowledge" },
          { label: "Profiles" },
          { label: "Review" },
        ]}
        currentIndex={1}
      />

      <div className="flex items-center gap-3">
        <ToggleSwitch checked={gateEnabled} onCheckedChange={setGateEnabled} />
        <span className="text-sm text-text-secondary">
          Require blueprint approval before content generation
        </span>
      </div>
    </Card>
  );
}
