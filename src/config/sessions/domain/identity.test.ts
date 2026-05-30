import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../types.js";
import {
  canonicalizeSessionIdentity,
  describeSessionIdentity,
  resolveSessionIdentity,
} from "./identity.js";

describe("session identity domain", () => {
  it("describes canonical agent sessions without changing legacy request semantics", () => {
    expect(canonicalizeSessionIdentity({ agentId: "Ops", sessionKey: "MAIN" })).toBe(
      "agent:ops:main",
    );
    expect(describeSessionIdentity("agent:Ops:Slack:Channel:C123")).toMatchObject({
      canonicalKey: "agent:ops:slack:channel:c123",
      requestKey: "slack:channel:c123",
      agentId: "ops",
      kind: "channel",
      shape: "agent",
      isLegacyAlias: true,
    });
  });

  it("classifies edge case keys used by resolve/list callers", () => {
    expect(describeSessionIdentity("agent:main:subagent:abc").kind).toBe("subagent");
    expect(describeSessionIdentity("agent:main:cron:daily:run:123").kind).toBe("cron-run");
    expect(describeSessionIdentity("agent:main:acp:workspace").kind).toBe("acp");
    expect(describeSessionIdentity("agent:main:slack:channel:c123:thread:456")).toMatchObject({
      kind: "thread",
      threadId: "456",
      parentSessionKey: "agent:main:slack:channel:c123",
    });
    expect(describeSessionIdentity("../bad")).toMatchObject({
      canonicalKey: "../bad",
      kind: "unknown",
      shape: "legacy_or_alias",
    });
  });

  it("preserves legacy case-insensitive store resolution", () => {
    const newer: SessionEntry = { sessionId: "new", updatedAt: 2 };
    const older: SessionEntry = { sessionId: "old", updatedAt: 1 };
    expect(
      resolveSessionIdentity({
        store: {
          "agent:main:slack:channel:c123": older,
          "Agent:Main:Slack:Channel:C123": newer,
        },
        sessionKey: "AGENT:MAIN:SLACK:CHANNEL:C123",
      }),
    ).toMatchObject({
      normalizedKey: "agent:main:slack:channel:c123",
      existing: newer,
    });
  });
});
