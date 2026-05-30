import { describe, expect, it } from "vitest";
import { classifyPersistedRuntimeField, classifySessionRetention } from "./index.js";

describe("session retention and runtime boundaries", () => {
  it("maps known synthetic kinds without making human sessions prune-eligible by default", () => {
    expect(classifySessionRetention("agent:main:subagent:child")).toMatchObject({
      class: "subagent-run",
      preserveByDefault: false,
    });
    expect(classifySessionRetention("agent:main:cron:daily:run:abc")).toMatchObject({
      class: "cron-run",
      preserveByDefault: false,
    });
    expect(classifySessionRetention("agent:main:slack:channel:c123")).toMatchObject({
      class: "human-facing",
      preserveByDefault: true,
    });
    expect(classifySessionRetention("legacy-human-key")).toMatchObject({
      class: "unknown-legacy",
      preserveByDefault: true,
    });
  });

  it("treats stale running status as a recovery hint, not live state", () => {
    expect(classifyPersistedRuntimeField("status", { status: "running" })).toMatchObject({
      class: "recovery-hint",
      needsReconciliation: true,
    });
  });

  it("does not discard durable user overrides as ephemeral", () => {
    expect(
      classifyPersistedRuntimeField("modelOverride", { status: "done", modelOverride: "gpt-5.4" }),
    ).toMatchObject({
      class: "durable-override",
      needsReconciliation: false,
    });
  });
});
