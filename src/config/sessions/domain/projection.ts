import type { SessionEntry } from "../types.js";
import { describeSessionIdentity, type SessionIdentityKind } from "./identity.js";

export type SessionProjectionTier = "minimal" | "display" | "details" | "diagnostic";

export type SessionMinimalProjection = {
  sessionKey: string;
  sessionId: string;
  updatedAt: number;
  kind: SessionIdentityKind;
  agentId: string;
};

export type SessionDisplayProjection = SessionMinimalProjection &
  Pick<
    SessionEntry,
    "label" | "displayName" | "channel" | "groupId" | "subject" | "status" | "lastInteractionAt"
  >;

export type SessionDetailsProjection = SessionDisplayProjection &
  Pick<
    SessionEntry,
    | "sessionFile"
    | "parentSessionKey"
    | "spawnedBy"
    | "modelOverride"
    | "authProfileOverride"
    | "providerOverride"
    | "inputTokens"
    | "outputTokens"
    | "totalTokens"
    | "estimatedCostUsd"
  >;

export type SessionDiagnosticProjection = SessionDetailsProjection &
  Pick<
    SessionEntry,
    | "pluginExtensions"
    | "pluginDebugEntries"
    | "acp"
    | "heartbeatTaskState"
    | "compactionCheckpoints"
    | "systemPromptReport"
  > & {
    totalTokensFresh?: boolean;
    shape: ReturnType<typeof describeSessionIdentity>["shape"];
    isSynthetic: boolean;
  };

export type SessionProjection<T extends SessionProjectionTier = SessionProjectionTier> =
  T extends "minimal"
    ? SessionMinimalProjection
    : T extends "display"
      ? SessionDisplayProjection
      : T extends "details"
        ? SessionDetailsProjection
        : SessionDiagnosticProjection;

export function projectSessionEntry<T extends SessionProjectionTier>(
  sessionKey: string,
  entry: SessionEntry,
  tier: T,
): SessionProjection<T> {
  const identity = describeSessionIdentity(sessionKey);
  const minimal: SessionMinimalProjection = {
    sessionKey: identity.canonicalKey,
    sessionId: entry.sessionId,
    updatedAt: entry.updatedAt,
    kind: identity.kind,
    agentId: identity.agentId,
  };
  if (tier === "minimal") {
    return minimal as SessionProjection<T>;
  }
  const display: SessionDisplayProjection = {
    ...minimal,
    label: entry.label,
    displayName: entry.displayName,
    channel: entry.channel,
    groupId: entry.groupId,
    subject: entry.subject,
    status: entry.status,
    lastInteractionAt: entry.lastInteractionAt,
  };
  if (tier === "display") {
    return display as SessionProjection<T>;
  }
  const details: SessionDetailsProjection = {
    ...display,
    sessionFile: entry.sessionFile,
    parentSessionKey: entry.parentSessionKey,
    spawnedBy: entry.spawnedBy,
    modelOverride: entry.modelOverride,
    authProfileOverride: entry.authProfileOverride,
    providerOverride: entry.providerOverride,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    totalTokens: entry.totalTokens,
    estimatedCostUsd: entry.estimatedCostUsd,
  };
  if (tier === "details") {
    return details as SessionProjection<T>;
  }
  return {
    ...details,
    pluginExtensions: entry.pluginExtensions,
    pluginDebugEntries: entry.pluginDebugEntries,
    acp: entry.acp,
    heartbeatTaskState: entry.heartbeatTaskState,
    compactionCheckpoints: entry.compactionCheckpoints,
    systemPromptReport: entry.systemPromptReport,
    totalTokensFresh: entry.totalTokensFresh,
    shape: identity.shape,
    isSynthetic: identity.isSynthetic,
  } as SessionProjection<T>;
}
