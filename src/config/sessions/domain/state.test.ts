import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../types.js";
import {
  fromSessionDomainState,
  patchSessionDomain,
  patchSessionExtensions,
  patchSessionLifecycle,
  patchSessionRuntimeOverrides,
  patchSessionTranscript,
  projectSessionEntry,
  toSessionDomainState,
} from "./index.js";

const richEntry: SessionEntry & { unknownFutureField?: unknown } = {
  sessionId: "sid-1",
  updatedAt: 10,
  sessionFile: "sessions/sid-1.jsonl",
  label: "Ops",
  displayName: "Operations",
  status: "running",
  modelOverride: "gpt-5.4",
  authProfileOverride: "work",
  pluginExtensions: { demo: { custom: { kept: true } } },
  acp: {
    backend: "codex",
    agent: "main",
    runtimeSessionName: "runtime",
    mode: "persistent",
    state: "idle",
    lastActivityAt: 1,
  },
  heartbeatTaskState: { ping: 1 },
  totalTokens: 99,
  unknownFutureField: { preserved: true },
};

describe("session state domain adapters", () => {
  it("round-trips legacy SessionEntry fields and unknown extension data", () => {
    const roundTrip = fromSessionDomainState(toSessionDomainState(richEntry));
    expect(roundTrip).toEqual(richEntry);
  });

  it("patches one domain without clearing unrelated domains", () => {
    const patched = patchSessionLifecycle(richEntry, { status: "done", endedAt: 20 });
    expect(patched.status).toBe("done");
    expect(patched.endedAt).toBe(20);
    expect(patched.sessionFile).toBe(richEntry.sessionFile);
    expect(patched.pluginExtensions).toEqual(richEntry.pluginExtensions);
    expect((patched as typeof richEntry).unknownFutureField).toEqual({ preserved: true });
  });

  it("keeps transcript, runtime, and extension helpers domain-scoped", () => {
    expect(patchSessionTranscript(richEntry, { sessionFile: "new.jsonl" })).toMatchObject({
      sessionFile: "new.jsonl",
      modelOverride: "gpt-5.4",
    });
    expect(patchSessionRuntimeOverrides(richEntry, { modelOverride: "gpt-5.5" })).toMatchObject({
      sessionFile: "sessions/sid-1.jsonl",
      modelOverride: "gpt-5.5",
    });
    expect(
      patchSessionExtensions(richEntry, { pluginExtensions: { other: { v: 1 } } }),
    ).toMatchObject({
      pluginExtensions: { other: { v: 1 } },
      sessionFile: "sessions/sid-1.jsonl",
    });
  });

  it("rejects cross-domain accidental writes", () => {
    expect(() =>
      patchSessionDomain(richEntry, "extensions", { sessionFile: "bad.jsonl" } as never),
    ).toThrow("Session extensions patch cannot write sessionFile");
  });

  it("keeps minimal projections lightweight", () => {
    const minimal = projectSessionEntry("agent:main:slack:channel:c123", richEntry, "minimal");
    expect(minimal).toEqual({
      sessionKey: "agent:main:slack:channel:c123",
      sessionId: "sid-1",
      updatedAt: 10,
      kind: "channel",
      agentId: "main",
    });
    expect(JSON.stringify(minimal)).not.toContain("pluginExtensions");
    expect(JSON.stringify(minimal)).not.toContain("sessionFile");
  });
});
