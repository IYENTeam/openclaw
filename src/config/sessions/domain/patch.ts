import type { SessionEntry } from "../types.js";
import {
  mergeSessionDomainState,
  SESSION_DOMAIN_KEYS,
  toSessionDomainState,
  type SessionDomainState,
} from "./state.js";

export type SessionDomainPatchName = Exclude<keyof SessionDomainState, "legacy">;

function assertDomainPatchKeys<K extends SessionDomainPatchName>(
  domain: K,
  patch: Partial<SessionDomainState[K]>,
): void {
  const allowed = new Set<string>(SESSION_DOMAIN_KEYS[domain]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new Error(`Session ${domain} patch cannot write ${key}`);
    }
  }
}

export function patchSessionDomain<K extends SessionDomainPatchName>(
  entry: SessionEntry,
  domain: K,
  patch: Partial<SessionDomainState[K]>,
): SessionEntry {
  assertDomainPatchKeys(domain, patch);
  const state = toSessionDomainState(entry);
  return mergeSessionDomainState(entry, {
    [domain]: { ...state[domain], ...patch },
  } as Partial<Omit<SessionDomainState, "legacy">>);
}

export const patchSessionLifecycle = (
  entry: SessionEntry,
  patch: Partial<SessionDomainState["lifecycle"]>,
): SessionEntry => patchSessionDomain(entry, "lifecycle", patch);

export const patchSessionRouting = (
  entry: SessionEntry,
  patch: Partial<SessionDomainState["routing"]>,
): SessionEntry => patchSessionDomain(entry, "routing", patch);

export const patchSessionRuntimeOverrides = (
  entry: SessionEntry,
  patch: Partial<SessionDomainState["runtimeOverrides"]>,
): SessionEntry => patchSessionDomain(entry, "runtimeOverrides", patch);

export const patchSessionTranscript = (
  entry: SessionEntry,
  patch: Partial<SessionDomainState["transcript"]>,
): SessionEntry => patchSessionDomain(entry, "transcript", patch);

export const patchSessionExtensions = (
  entry: SessionEntry,
  patch: Partial<SessionDomainState["extensions"]>,
): SessionEntry => patchSessionDomain(entry, "extensions", patch);
