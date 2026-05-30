import {
  DEFAULT_AGENT_ID,
  classifySessionKeyShape,
  normalizeAgentId,
  resolveAgentIdFromSessionKey,
  toAgentRequestSessionKey,
  toAgentStoreSessionKey,
  type SessionKeyShape,
} from "../../../routing/session-key.js";
import {
  isAcpSessionKey,
  isCronRunSessionKey,
  isCronSessionKey,
  isSubagentSessionKey,
  parseAgentSessionKey,
  parseRawSessionConversationRef,
  parseThreadSessionSuffix,
  resolveThreadParentSessionKey,
} from "../../../sessions/session-key-utils.js";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "../../../shared/string-coerce.js";
import { normalizeStoreSessionKey, resolveSessionStoreEntry } from "../store-entry.js";
import type { SessionEntry } from "../types.js";

export type SessionIdentityKind =
  | "main"
  | "direct"
  | "group"
  | "channel"
  | "thread"
  | "subagent"
  | "cron"
  | "cron-run"
  | "acp"
  | "heartbeat"
  | "legacy"
  | "unknown";

export type SessionIdentityDescriptor = {
  rawKey: string;
  canonicalKey: string;
  requestKey: string | undefined;
  shape: SessionKeyShape;
  kind: SessionIdentityKind;
  agentId: string;
  baseSessionKey?: string;
  threadId?: string;
  parentSessionKey?: string;
  conversation?: ReturnType<typeof parseRawSessionConversationRef>;
  isSynthetic: boolean;
  isLegacyAlias: boolean;
};

export type SessionIdentityResolution = {
  normalizedKey: string;
  existing: SessionEntry | undefined;
  legacyKeys: string[];
};

function classifyByRequestKey(requestKey: string | undefined, rawKey: string): SessionIdentityKind {
  const key = requestKey ?? rawKey;
  const normalized = normalizeLowercaseStringOrEmpty(key);
  if (!normalized) {
    return "unknown";
  }
  if (isCronRunSessionKey(rawKey)) {
    return "cron-run";
  }
  if (isCronSessionKey(rawKey)) {
    return "cron";
  }
  if (isAcpSessionKey(rawKey)) {
    return "acp";
  }
  if (isSubagentSessionKey(rawKey)) {
    return "subagent";
  }
  if (normalized.endsWith(":heartbeat")) {
    return "heartbeat";
  }
  if (parseThreadSessionSuffix(key).threadId) {
    return "thread";
  }
  const conversation = parseRawSessionConversationRef(key);
  if (conversation?.kind === "group") {
    return "group";
  }
  if (conversation?.kind === "channel") {
    return "channel";
  }
  if (normalized.includes(":direct:")) {
    return "direct";
  }
  if (normalized === "main") {
    return "main";
  }
  return parseAgentSessionKey(rawKey) ? "legacy" : "unknown";
}

export function describeSessionIdentity(
  sessionKey: string | undefined | null,
): SessionIdentityDescriptor {
  const rawKey = normalizeOptionalString(sessionKey) ?? "";
  const canonicalKey = normalizeStoreSessionKey(rawKey);
  const shape = classifySessionKeyShape(rawKey);
  const requestKey = toAgentRequestSessionKey(canonicalKey);
  const { baseSessionKey, threadId } = parseThreadSessionSuffix(canonicalKey);
  const kind = classifyByRequestKey(requestKey, canonicalKey);
  const conversation = parseRawSessionConversationRef(canonicalKey);
  return {
    rawKey,
    canonicalKey,
    requestKey,
    shape,
    kind,
    agentId: resolveAgentIdFromSessionKey(canonicalKey || DEFAULT_AGENT_ID),
    baseSessionKey,
    threadId,
    parentSessionKey: resolveThreadParentSessionKey(canonicalKey) ?? undefined,
    conversation,
    isSynthetic: kind === "heartbeat" || kind === "cron-run" || kind === "subagent",
    isLegacyAlias: rawKey.trim() !== canonicalKey,
  };
}

export function canonicalizeSessionIdentity(params: {
  agentId?: string | undefined;
  sessionKey: string | undefined | null;
  mainKey?: string | undefined;
}): string {
  return toAgentStoreSessionKey({
    agentId: normalizeAgentId(params.agentId ?? DEFAULT_AGENT_ID),
    requestKey: params.sessionKey,
    mainKey: params.mainKey,
  });
}

export function resolveSessionIdentity(params: {
  store: Record<string, SessionEntry>;
  sessionKey: string;
}): SessionIdentityResolution {
  return resolveSessionStoreEntry(params);
}
