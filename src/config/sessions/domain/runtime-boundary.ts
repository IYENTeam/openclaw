import type { SessionEntry } from "../types.js";

export type RuntimeBoundaryClass = "durable-override" | "recovery-hint" | "ephemeral-only";

export type RuntimeBoundaryDecision = {
  class: RuntimeBoundaryClass;
  needsReconciliation: boolean;
  reason: string;
};

export function classifyPersistedRuntimeField(
  field: keyof SessionEntry,
  entry: Pick<
    SessionEntry,
    "status" | "modelOverride" | "authProfileOverride" | "thinkingLevel" | "fastMode"
  >,
): RuntimeBoundaryDecision {
  if (
    field === "modelOverride" ||
    field === "authProfileOverride" ||
    field === "thinkingLevel" ||
    field === "fastMode"
  ) {
    return {
      class: "durable-override",
      needsReconciliation: false,
      reason: "explicit session override survives restarts",
    };
  }
  if (field === "status" && entry.status === "running") {
    return {
      class: "recovery-hint",
      needsReconciliation: true,
      reason: "persisted running state is not proof of a live runtime after restart",
    };
  }
  if (
    field === "liveModelSwitchPending" ||
    field === "fallbackNoticeActiveModel" ||
    field === "fallbackNoticeSelectedModel" ||
    field === "fallbackNoticeReason"
  ) {
    return {
      class: "ephemeral-only",
      needsReconciliation: true,
      reason: "active-run coordination state must be validated against runtime",
    };
  }
  return {
    class: "recovery-hint",
    needsReconciliation: false,
    reason: "durable field may inform projections but is not live runtime proof",
  };
}
