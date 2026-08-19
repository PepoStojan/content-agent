"use client";

import { useState } from "react";

import { LockedTab } from "@/components/design-system/locked-tab";

type WorkspaceTab = "brief" | "blueprint";

/**
 * Makes the project workspace tab bar stateful (Phase 4.4). Brief
 * Review and Blueprint are both real, switchable tabs now.
 * Content Editor's padlock reflects `contentEditorUnlocked`
 * (derived from `projects.status` reaching `blueprint_approved` or
 * later) but has no content or navigation wired yet — Content
 * generation itself is a later phase, so unlocking only removes the
 * padlock/no-op click styling, it doesn't add a real tab. QA/Export
 * stay hardcoded locked, unchanged. Locking must be driven by the
 * same `projects.status` source of truth used for the header status
 * badge, never by which tab happens to be open (Design V1's
 * "Approval & Provenance Rules" #2).
 */
export function ProjectTabs({
  blueprintUnlocked,
  contentEditorUnlocked,
  briefReview,
  blueprintReview,
  sidebar,
}: {
  blueprintUnlocked: boolean;
  contentEditorUnlocked: boolean;
  briefReview: React.ReactNode;
  blueprintReview: React.ReactNode;
  sidebar: React.ReactNode;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("brief");

  return (
    <>
      <div className="px-10">
        <div className="flex gap-1 overflow-x-auto border-b border-border">
          <LockedTab label="Brief Review" active={tab === "brief"} onClick={() => setTab("brief")} />
          <LockedTab
            label="Blueprint"
            active={tab === "blueprint"}
            locked={!blueprintUnlocked}
            onClick={() => setTab("blueprint")}
          />
          <LockedTab label="Content Editor" locked={!contentEditorUnlocked} />
          <LockedTab label="QA" locked />
          <LockedTab label="Export" locked />
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-y-auto p-10">
        {tab === "brief" ? briefReview : blueprintReview}
        {sidebar}
      </div>
    </>
  );
}
