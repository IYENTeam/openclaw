import type { SessionEntry } from "../types.js";

export type SessionIdentityState = Pick<
  SessionEntry,
  | "sessionId"
  | "label"
  | "displayName"
  | "channel"
  | "groupId"
  | "subject"
  | "groupChannel"
  | "space"
  | "origin"
  | "deliveryContext"
  | "lastChannel"
  | "lastTo"
  | "lastAccountId"
  | "lastThreadId"
  | "chatType"
>;
export type SessionTranscriptState = Pick<
  SessionEntry,
  | "sessionFile"
  | "systemSent"
  | "compactionCount"
  | "compactionCheckpoints"
  | "memoryFlushAt"
  | "memoryFlushCompactionCount"
  | "memoryFlushContextHash"
>;
export type SessionLifecycleState = Pick<
  SessionEntry,
  | "updatedAt"
  | "sessionStartedAt"
  | "lastInteractionAt"
  | "startedAt"
  | "endedAt"
  | "runtimeMs"
  | "status"
  | "abortedLastRun"
  | "abortCutoffMessageSid"
  | "abortCutoffTimestamp"
>;
export type SessionRoutingState = Pick<
  SessionEntry,
  | "groupActivation"
  | "groupActivationNeedsSystemIntro"
  | "sendPolicy"
  | "queueMode"
  | "queueDebounceMs"
  | "queueCap"
  | "queueDrop"
  | "execHost"
  | "execSecurity"
  | "execAsk"
  | "execNode"
  | "responseUsage"
>;
export type SessionRuntimeOverrideState = Pick<
  SessionEntry,
  | "thinkingLevel"
  | "fastMode"
  | "verboseLevel"
  | "traceLevel"
  | "reasoningLevel"
  | "elevatedLevel"
  | "ttsAuto"
  | "providerOverride"
  | "modelOverride"
  | "agentRuntimeOverride"
  | "modelOverrideSource"
  | "authProfileOverride"
  | "authProfileOverrideSource"
  | "authProfileOverrideCompactionCount"
  | "liveModelSwitchPending"
  | "modelProvider"
  | "model"
  | "agentHarnessId"
  | "fallbackNoticeSelectedModel"
  | "fallbackNoticeActiveModel"
  | "fallbackNoticeReason"
>;
export type SessionLineageState = Pick<
  SessionEntry,
  | "spawnedBy"
  | "spawnedWorkspaceDir"
  | "parentSessionKey"
  | "forkedFromParent"
  | "spawnDepth"
  | "subagentRole"
  | "subagentControlScope"
  | "pluginOwnerId"
>;
export type SessionUsageProjectionState = Pick<
  SessionEntry,
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "totalTokensFresh"
  | "estimatedCostUsd"
  | "cacheRead"
  | "cacheWrite"
  | "contextTokens"
>;
export type SessionExtensionState = Pick<
  SessionEntry,
  | "pluginExtensions"
  | "pluginNextTurnInjections"
  | "skillsSnapshot"
  | "systemPromptReport"
  | "pluginDebugEntries"
  | "acp"
>;
export type SessionHeartbeatState = Pick<
  SessionEntry,
  | "lastHeartbeatText"
  | "lastHeartbeatSentAt"
  | "heartbeatIsolatedBaseSessionKey"
  | "heartbeatTaskState"
>;
export type SessionCliBindingState = Pick<
  SessionEntry,
  "cliSessionIds" | "cliSessionBindings" | "claudeCliSessionId"
>;
export type SessionTtsState = Pick<SessionEntry, "lastTtsReadLatestHash" | "lastTtsReadLatestAt">;

export type SessionDomainState = {
  identity: SessionIdentityState;
  transcript: SessionTranscriptState;
  lifecycle: SessionLifecycleState;
  routing: SessionRoutingState;
  runtimeOverrides: SessionRuntimeOverrideState;
  lineage: SessionLineageState;
  usageProjection: SessionUsageProjectionState;
  extensions: SessionExtensionState;
  heartbeat: SessionHeartbeatState;
  cliBindings: SessionCliBindingState;
  tts: SessionTtsState;
  legacy: Record<string, unknown>;
};

type SessionEntryKey = keyof SessionEntry;

export const SESSION_DOMAIN_KEYS = {
  identity: [
    "sessionId",
    "label",
    "displayName",
    "channel",
    "groupId",
    "subject",
    "groupChannel",
    "space",
    "origin",
    "deliveryContext",
    "lastChannel",
    "lastTo",
    "lastAccountId",
    "lastThreadId",
    "chatType",
  ],
  transcript: [
    "sessionFile",
    "systemSent",
    "compactionCount",
    "compactionCheckpoints",
    "memoryFlushAt",
    "memoryFlushCompactionCount",
    "memoryFlushContextHash",
  ],
  lifecycle: [
    "updatedAt",
    "sessionStartedAt",
    "lastInteractionAt",
    "startedAt",
    "endedAt",
    "runtimeMs",
    "status",
    "abortedLastRun",
    "abortCutoffMessageSid",
    "abortCutoffTimestamp",
  ],
  routing: [
    "groupActivation",
    "groupActivationNeedsSystemIntro",
    "sendPolicy",
    "queueMode",
    "queueDebounceMs",
    "queueCap",
    "queueDrop",
    "execHost",
    "execSecurity",
    "execAsk",
    "execNode",
    "responseUsage",
  ],
  runtimeOverrides: [
    "thinkingLevel",
    "fastMode",
    "verboseLevel",
    "traceLevel",
    "reasoningLevel",
    "elevatedLevel",
    "ttsAuto",
    "providerOverride",
    "modelOverride",
    "agentRuntimeOverride",
    "modelOverrideSource",
    "authProfileOverride",
    "authProfileOverrideSource",
    "authProfileOverrideCompactionCount",
    "liveModelSwitchPending",
    "modelProvider",
    "model",
    "agentHarnessId",
    "fallbackNoticeSelectedModel",
    "fallbackNoticeActiveModel",
    "fallbackNoticeReason",
  ],
  lineage: [
    "spawnedBy",
    "spawnedWorkspaceDir",
    "parentSessionKey",
    "forkedFromParent",
    "spawnDepth",
    "subagentRole",
    "subagentControlScope",
    "pluginOwnerId",
  ],
  usageProjection: [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "totalTokensFresh",
    "estimatedCostUsd",
    "cacheRead",
    "cacheWrite",
    "contextTokens",
  ],
  extensions: [
    "pluginExtensions",
    "pluginExtensionSlotKeys",
    "pluginNextTurnInjections",
    "skillsSnapshot",
    "systemPromptReport",
    "pluginDebugEntries",
    "acp",
  ],
  heartbeat: [
    "lastHeartbeatText",
    "lastHeartbeatSentAt",
    "heartbeatIsolatedBaseSessionKey",
    "heartbeatTaskState",
  ],
  cliBindings: ["cliSessionIds", "cliSessionBindings", "claudeCliSessionId"],
  tts: ["lastTtsReadLatestHash", "lastTtsReadLatestAt"],
} as const satisfies Record<
  Exclude<keyof SessionDomainState, "legacy">,
  readonly SessionEntryKey[]
>;

const ASSIGNED_KEYS = new Set<SessionEntryKey>(Object.values(SESSION_DOMAIN_KEYS).flat());

function pick<T extends readonly SessionEntryKey[]>(
  entry: SessionEntry,
  keys: T,
): Pick<SessionEntry, T[number]> {
  const result: Partial<SessionEntry> = {};
  for (const key of keys) {
    if (key in entry) {
      result[key] = entry[key] as never;
    }
  }
  return result as Pick<SessionEntry, T[number]>;
}

export function toSessionDomainState(entry: SessionEntry): SessionDomainState {
  const legacy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!ASSIGNED_KEYS.has(key as SessionEntryKey)) {
      legacy[key] = value;
    }
  }
  return {
    identity: pick(entry, SESSION_DOMAIN_KEYS.identity),
    transcript: pick(entry, SESSION_DOMAIN_KEYS.transcript),
    lifecycle: pick(entry, SESSION_DOMAIN_KEYS.lifecycle),
    routing: pick(entry, SESSION_DOMAIN_KEYS.routing),
    runtimeOverrides: pick(entry, SESSION_DOMAIN_KEYS.runtimeOverrides),
    lineage: pick(entry, SESSION_DOMAIN_KEYS.lineage),
    usageProjection: pick(entry, SESSION_DOMAIN_KEYS.usageProjection),
    extensions: pick(entry, SESSION_DOMAIN_KEYS.extensions),
    heartbeat: pick(entry, SESSION_DOMAIN_KEYS.heartbeat),
    cliBindings: pick(entry, SESSION_DOMAIN_KEYS.cliBindings),
    tts: pick(entry, SESSION_DOMAIN_KEYS.tts),
    legacy,
  };
}

export function fromSessionDomainState(state: SessionDomainState): SessionEntry {
  return {
    ...state.legacy,
    ...state.heartbeat,
    ...state.extensions,
    ...state.identity,
    ...state.transcript,
    ...state.lineage,
    ...state.lifecycle,
    ...state.routing,
    ...state.runtimeOverrides,
    ...state.usageProjection,
    ...state.cliBindings,
    ...state.tts,
  } as SessionEntry;
}

export function mergeSessionDomainState(
  base: SessionEntry,
  patch: Partial<Omit<SessionDomainState, "legacy">>,
): SessionEntry {
  return fromSessionDomainState({ ...toSessionDomainState(base), ...patch });
}
