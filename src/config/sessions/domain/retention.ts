import {
  isAcpSessionKey,
  isCronRunSessionKey,
  isCronSessionKey,
  isSubagentSessionKey,
} from "../../../sessions/session-key-utils.js";
import type { SessionEntry } from "../types.js";
import { describeSessionIdentity } from "./identity.js";

export type SessionRetentionClass =
  | "human-facing"
  | "subagent-run"
  | "cron-run"
  | "heartbeat"
  | "plugin-runtime"
  | "archive"
  | "diagnostic"
  | "unknown-legacy";

export type SessionRetentionDecision = {
  class: SessionRetentionClass;
  preserveByDefault: boolean;
  reason: string;
};

export function classifySessionRetention(
  sessionKey: string,
  entry?: Pick<
    SessionEntry,
    "pluginOwnerId" | "heartbeatIsolatedBaseSessionKey" | "acp" | "status"
  >,
): SessionRetentionDecision {
  const identity = describeSessionIdentity(sessionKey);
  if (entry?.heartbeatIsolatedBaseSessionKey || identity.kind === "heartbeat") {
    return { class: "heartbeat", preserveByDefault: false, reason: "synthetic heartbeat session" };
  }
  if (isCronRunSessionKey(sessionKey) || identity.kind === "cron-run") {
    return { class: "cron-run", preserveByDefault: false, reason: "isolated cron run session" };
  }
  if (isSubagentSessionKey(sessionKey) || identity.kind === "subagent") {
    return { class: "subagent-run", preserveByDefault: false, reason: "subagent runtime session" };
  }
  if (entry?.pluginOwnerId) {
    return {
      class: "plugin-runtime",
      preserveByDefault: false,
      reason: "plugin-owned runtime session",
    };
  }
  if (entry?.acp || isAcpSessionKey(sessionKey)) {
    return {
      class: "plugin-runtime",
      preserveByDefault: true,
      reason: "ACP session state requires compatibility preservation",
    };
  }
  if (isCronSessionKey(sessionKey) || identity.kind === "cron") {
    return {
      class: "human-facing",
      preserveByDefault: true,
      reason: "cron definition/session binding is durable state",
    };
  }
  if (identity.kind === "unknown") {
    return {
      class: "unknown-legacy",
      preserveByDefault: true,
      reason: "unknown legacy session keys are preservation-biased",
    };
  }
  return { class: "human-facing", preserveByDefault: true, reason: "default user-visible session" };
}
