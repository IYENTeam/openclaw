const TOOL_CALL_TYPES = new Set(["toolCall", "tool_call", "tool_use", "function_call"]);
const TOOL_RESULT_TYPES = new Set(["toolResult", "tool_result", "function_call_output"]);
const TOOL_RESULT_ROLES = new Set(["toolResult", "tool", "tool_result"]);

type Part = Record<string, unknown> | null | undefined;
type Message = Record<string, unknown> | null | undefined;

function normalizeContentParts(content: unknown): Part[] {
  if (Array.isArray(content)) {
    return content as Part[];
  }
  if (content == null) {
    return [];
  }
  if (typeof content === "string") {
    return [{ type: "text", text: content } as Part];
  }
  if (typeof content === "object") {
    return [content as Part];
  }
  return [];
}

function normalizeCallId(rawId: unknown): string | null {
  if (typeof rawId !== "string") {
    return null;
  }
  const head = rawId.split("|")[0]?.trim();
  return head !== undefined && head !== "" ? head : null;
}

function extractCallIdFromPart(part: Part): string | null {
  if (!part || typeof part !== "object") {
    return null;
  }
  const candidates = [
    part.id,
    part.call_id,
    part.callId,
    part.toolUseId,
    part.tool_use_id,
    part.toolCallId,
    part.tool_call_id,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeCallId(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function extractMessageDirectCallId(message: Record<string, unknown>): string | null {
  const candidates = [
    message.toolCallId,
    message.tool_call_id,
    message.toolUseId,
    message.tool_use_id,
    message.callId,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeCallId(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

export type SanitizeResult<T extends Message = Message> = {
  messages: T[];
  sanitized: boolean;
  removedCallIds: string[];
  removedResultMessages: number;
};

/**
 * Drop orphan tool-call / tool-result pairs from an in-memory message list.
 *
 * Anthropic and OpenAI both reject conversations where an assistant emits a
 * tool_use block without a matching tool_result, or vice versa, with errors
 * like "No tool call found" / "tool_use_id ... not found". The sanitizer
 * mirrors the conservative policy used in the session-branch-engine
 * prototype:
 *   1. assistant.toolCall(id=X) without a downstream toolResult(id=X)
 *      → remove the toolCall part only (keep text/thinking parts).
 *   2. toolResult(id=Y) without an upstream toolCall(id=Y)
 *      → drop the toolResult message in full.
 *   3. The input array is not mutated.
 */
export function sanitizeMessagesForToolPairs<T extends Message = Message>(
  messages: readonly T[],
): SanitizeResult<T> {
  const safeMessages = Array.isArray(messages) ? (messages as T[]) : [];
  const seenCalls = new Map<string, { messageIndex: number }>();
  const matchedCalls = new Set<string>();

  for (let i = 0; i < safeMessages.length; i++) {
    const message = safeMessages[i];
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = message.role;
    const parts = normalizeContentParts(message.content);
    if (role === "assistant") {
      for (const part of parts) {
        if (part && TOOL_CALL_TYPES.has(String(part.type))) {
          const id = extractCallIdFromPart(part);
          if (id !== null) {
            seenCalls.set(id, { messageIndex: i });
          }
        }
      }
    } else if (typeof role === "string" && TOOL_RESULT_ROLES.has(role)) {
      const directId = extractMessageDirectCallId(message);
      if (directId !== null && seenCalls.has(directId)) {
        matchedCalls.add(directId);
      }
      for (const part of parts) {
        if (part && TOOL_RESULT_TYPES.has(String(part.type))) {
          const id = extractCallIdFromPart(part);
          if (id !== null && seenCalls.has(id)) {
            matchedCalls.add(id);
          }
        }
      }
    }
  }

  const orphanCallIds = new Set<string>();
  for (const id of seenCalls.keys()) {
    if (!matchedCalls.has(id)) {
      orphanCallIds.add(id);
    }
  }

  const orphanResultIndices = new Set<number>();
  for (let i = 0; i < safeMessages.length; i++) {
    const message = safeMessages[i];
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = message.role;
    if (typeof role !== "string" || !TOOL_RESULT_ROLES.has(role)) {
      continue;
    }
    const parts = normalizeContentParts(message.content);
    const directId = extractMessageDirectCallId(message);
    let hasMatched = directId !== null ? seenCalls.has(directId) : false;
    if (!hasMatched) {
      for (const part of parts) {
        if (part && TOOL_RESULT_TYPES.has(String(part.type))) {
          const id = extractCallIdFromPart(part);
          if (id !== null && seenCalls.has(id)) {
            hasMatched = true;
            break;
          }
        }
      }
    }
    if (!hasMatched) {
      orphanResultIndices.add(i);
    }
  }

  if (orphanCallIds.size === 0 && orphanResultIndices.size === 0) {
    return {
      messages: safeMessages,
      sanitized: false,
      removedCallIds: [],
      removedResultMessages: 0,
    };
  }

  const out: T[] = [];
  for (let i = 0; i < safeMessages.length; i++) {
    if (orphanResultIndices.has(i)) {
      continue;
    }
    const message = safeMessages[i];
    if (!message || typeof message !== "object") {
      out.push(message);
      continue;
    }
    const role = message.role;
    const content = message.content;
    if (role !== "assistant" || !Array.isArray(content)) {
      out.push(message);
      continue;
    }
    const filtered = (content as Part[]).filter((part) => {
      if (!part || !TOOL_CALL_TYPES.has(String(part.type))) {
        return true;
      }
      const id = extractCallIdFromPart(part);
      if (id === null) {
        return true;
      }
      return !orphanCallIds.has(id);
    });
    if (filtered.length === content.length) {
      out.push(message);
    } else if (filtered.length === 0) {
      continue;
    } else {
      out.push({ ...message, content: filtered } as T);
    }
  }

  return {
    messages: out,
    sanitized: true,
    removedCallIds: Array.from(orphanCallIds),
    removedResultMessages: orphanResultIndices.size,
  };
}
