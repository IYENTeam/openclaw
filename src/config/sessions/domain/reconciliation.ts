import type { SessionEntry } from "../types.js";
import { classifySessionRetention, type SessionRetentionClass } from "./retention.js";
import { classifyPersistedRuntimeField } from "./runtime-boundary.js";

export type SessionReconciliationIssueCode =
  | "stale-running-state"
  | "missing-transcript"
  | "retention-review";

export type SessionReconciliationIssue = {
  code: SessionReconciliationIssueCode;
  sessionKey: string;
  severity: "info" | "warning";
  message: string;
};

export type SessionReconciliationReport = {
  generatedAt: number;
  sessionCount: number;
  issues: SessionReconciliationIssue[];
  retentionClasses: Record<SessionRetentionClass, number>;
  destructiveRepair: false;
};

const EMPTY_RETENTION_COUNTS: Record<SessionRetentionClass, number> = {
  "human-facing": 0,
  "subagent-run": 0,
  "cron-run": 0,
  heartbeat: 0,
  "plugin-runtime": 0,
  archive: 0,
  diagnostic: 0,
  "unknown-legacy": 0,
};

export function reconcileSessionStore(params: {
  store: Record<string, SessionEntry>;
  transcriptExists?: (entry: SessionEntry, sessionKey: string) => boolean;
  now?: number;
}): SessionReconciliationReport {
  const issues: SessionReconciliationIssue[] = [];
  const retentionClasses = { ...EMPTY_RETENTION_COUNTS };
  for (const [sessionKey, entry] of Object.entries(params.store)) {
    const retention = classifySessionRetention(sessionKey, entry);
    retentionClasses[retention.class] += 1;
    if (entry.status === "running") {
      const boundary = classifyPersistedRuntimeField("status", entry);
      if (boundary.needsReconciliation) {
        issues.push({
          code: "stale-running-state",
          sessionKey,
          severity: "warning",
          message: boundary.reason,
        });
      }
    }
    if (entry.sessionFile && params.transcriptExists?.(entry, sessionKey) === false) {
      issues.push({
        code: "missing-transcript",
        sessionKey,
        severity: "warning",
        message: "Session references a transcript file that was not found.",
      });
    }
    if (!retention.preserveByDefault) {
      issues.push({
        code: "retention-review",
        sessionKey,
        severity: "info",
        message: retention.reason,
      });
    }
  }
  return {
    generatedAt: params.now ?? Date.now(),
    sessionCount: Object.keys(params.store).length,
    issues,
    retentionClasses,
    destructiveRepair: false,
  };
}
