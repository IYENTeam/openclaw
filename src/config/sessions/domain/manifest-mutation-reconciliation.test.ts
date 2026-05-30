import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../types.js";
import {
  applySessionMutation,
  buildProjectionIndexEntry,
  buildTranscriptManifest,
  reconcileSessionStore,
} from "./index.js";

const entry: SessionEntry = {
  sessionId: "sid-1",
  updatedAt: 10,
  sessionFile: "sessions/sid-1.jsonl",
  label: "Ops",
  status: "running",
  pluginExtensions: { demo: { state: "kept" } },
};

describe("session manifest, mutation, and reconciliation foundations", () => {
  it("builds transcript manifests without reading private transcript content", () => {
    expect(
      buildTranscriptManifest({
        sessionKey: "agent:main:slack:channel:c123",
        entry,
        transcriptBytes: 1024,
        entryCount: 5,
        transcriptExists: true,
      }),
    ).toMatchObject({
      sessionKey: "agent:main:slack:channel:c123",
      sessionId: "sid-1",
      transcriptBytes: 1024,
      entryCount: 5,
      missingTranscript: false,
    });
  });

  it("builds projection index entries from lightweight display projection", () => {
    const manifest = buildTranscriptManifest({
      sessionKey: "agent:main:slack:channel:c123",
      entry,
      transcriptExists: true,
    });
    const indexed = buildProjectionIndexEntry({
      sessionKey: "agent:main:slack:channel:c123",
      entry,
      manifest,
    });
    expect(indexed.display).toMatchObject({
      sessionKey: "agent:main:slack:channel:c123",
      label: "Ops",
      kind: "channel",
    });
    expect(JSON.stringify(indexed.display)).not.toContain("pluginExtensions");
  });

  it("applies mutation markers while preserving unrelated plugin state", () => {
    const result = applySessionMutation(entry, {
      sessionKey: "agent:main:slack:channel:c123",
      domain: "lifecycle",
      patch: { status: "done", endedAt: 20 },
      operation: "complete-run",
      now: 123,
    });
    expect(result.entry).toMatchObject({
      status: "done",
      endedAt: 20,
      pluginExtensions: { demo: { state: "kept" } },
    });
    expect(result.marker).toMatchObject({
      sessionKey: "agent:main:slack:channel:c123",
      operation: "complete-run",
      status: "committed",
      startedAt: 123,
      completedAt: 123,
    });
  });

  it("reports startup reconciliation diagnostics without destructive repair", () => {
    const report = reconcileSessionStore({
      store: {
        "agent:main:slack:channel:c123": entry,
        "agent:main:subagent:child": { sessionId: "child", updatedAt: 1 },
      },
      transcriptExists: () => false,
      now: 500,
    });
    expect(report).toMatchObject({
      generatedAt: 500,
      sessionCount: 2,
      destructiveRepair: false,
    });
    expect(report.issues.map((issue) => issue.code)).toEqual([
      "stale-running-state",
      "missing-transcript",
      "retention-review",
    ]);
  });
});
