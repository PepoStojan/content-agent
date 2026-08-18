import type { Database } from "@/lib/supabase/types";

export type ProjectStatus = Database["public"]["Enums"]["project_status"];

export type StatusTone = "waiting" | "progress" | "success" | "warning" | "danger" | "neutral";

/**
 * Derives the Design V1 status badge (label + tone) from the real
 * project_status state machine. The badge itself is unchanged from
 * Design V1 — this is the mapping from the richer backing state to
 * that fixed visual set, per Architecture V1's "status badge must be
 * derived from actual state, never from which tab is open" rule.
 */
export function projectStatusBadge(status: ProjectStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case "draft":
    case "ingesting":
    case "ready_for_brief":
      return { label: "Draft", tone: "neutral" };
    case "brief_generated":
    case "brief_changes_requested":
      return { label: "Waiting for approval", tone: "waiting" };
    case "brief_approved":
    case "blueprint_generated":
    case "blueprint_changes_requested":
      return { label: "Blueprint review", tone: "progress" };
    case "blueprint_approved":
    case "generating_content":
    case "content_ready":
    case "ready_for_export":
    case "qa_warning":
      return { label: "In progress", tone: "progress" };
    case "qa_failed":
      return { label: "QA failed", tone: "danger" };
    case "exported":
      return { label: "Exported", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    default:
      return { label: "Draft", tone: "neutral" };
  }
}
