import crypto from "node:crypto";
import type { SessionEntry } from "../types.js";
import { patchSessionDomain, type SessionDomainPatchName } from "./patch.js";
import type { SessionDomainState } from "./state.js";

export type SessionTransactionMarker = {
  id: string;
  sessionKey: string;
  startedAt: number;
  completedAt?: number;
  operation: string;
  status: "pending" | "committed" | "rolled-back";
};

export type SessionMutation<K extends SessionDomainPatchName = SessionDomainPatchName> = {
  sessionKey: string;
  domain: K;
  patch: Partial<SessionDomainState[K]>;
  operation: string;
  now?: number;
};

export type SessionMutationResult = {
  entry: SessionEntry;
  marker: SessionTransactionMarker;
};

export function createSessionTransactionMarker(params: {
  sessionKey: string;
  operation: string;
  now?: number;
}): SessionTransactionMarker {
  const startedAt = params.now ?? Date.now();
  const digest = crypto
    .createHash("sha256")
    .update(`${params.sessionKey}\0${params.operation}\0${startedAt}`)
    .digest("hex")
    .slice(0, 16);
  return {
    id: `session-txn-${digest}`,
    sessionKey: params.sessionKey,
    startedAt,
    operation: params.operation,
    status: "pending",
  };
}

export function applySessionMutation<K extends SessionDomainPatchName>(
  entry: SessionEntry,
  mutation: SessionMutation<K>,
): SessionMutationResult {
  const marker = createSessionTransactionMarker({
    sessionKey: mutation.sessionKey,
    operation: mutation.operation,
    now: mutation.now,
  });
  return {
    entry: patchSessionDomain(entry, mutation.domain, mutation.patch),
    marker: { ...marker, completedAt: mutation.now ?? marker.startedAt, status: "committed" },
  };
}
