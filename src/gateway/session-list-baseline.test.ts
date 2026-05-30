import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { buildGatewaySessionRow, listSessionsFromStore } from "./session-utils.js";

const cfg = {
  session: { mainKey: "main" },
  agents: { list: [{ id: "main", default: true }] },
} as OpenClawConfig;

function createSyntheticStore(size: number, now = Date.now()): Record<string, SessionEntry> {
  const store: Record<string, SessionEntry> = {};
  for (let i = 0; i < size; i += 1) {
    const key = `agent:main:slack:channel:c${String(i).padStart(4, "0")}`;
    store[key] = {
      sessionId: `synthetic-${i}`,
      updatedAt: now - i,
      sessionFile: `sessions/synthetic-${i}.jsonl`,
      channel: "slack",
      chatType: "channel",
      subject: `Synthetic channel ${i}`,
      totalTokens: i,
      totalTokensFresh: true,
      pluginExtensions: {
        baseline: { marker: `extension-${i}` },
      },
    } as SessionEntry;
  }
  return store;
}

function measureList(size: number): { count: number; durationMs: number; firstKey?: string } {
  const store = createSyntheticStore(size);
  const started = performance.now();
  const result = listSessionsFromStore({
    cfg,
    storePath: `/tmp/openclaw-session-list-baseline-${size}/sessions.json`,
    store,
    opts: { limit: size, projectionTier: "display" },
  });
  const durationMs = performance.now() - started;
  return { count: result.count, durationMs, firstKey: result.sessions[0]?.key };
}

describe("sessions.list projection hot-path baseline", () => {
  it("lists synthetic stores at baseline sizes without transcript enrichment", () => {
    const measurements = [10, 100, 500].map(measureList);

    expect(measurements.map((measurement) => measurement.count)).toEqual([10, 100, 500]);
    expect(measurements.every((measurement) => Number.isFinite(measurement.durationMs))).toBe(true);
    expect(
      measurements.every((measurement) => measurement.firstKey?.startsWith("agent:main:")),
    ).toBe(true);
    expect(JSON.stringify(measurements)).not.toContain("/Users/");
    console.info("sessions.list synthetic baseline", measurements);
  });

  it("enforces the public minimal projection shape", () => {
    const store = createSyntheticStore(1);
    const result = listSessionsFromStore({
      cfg,
      storePath: "/tmp/openclaw-session-list-baseline/sessions.json",
      store,
      opts: { projectionTier: "minimal" },
    });

    expect(result.sessions).toHaveLength(1);
    expect(Object.keys(result.sessions[0] ?? {}).toSorted()).toEqual([
      "agentId",
      "key",
      "kind",
      "sessionId",
      "updatedAt",
    ]);
    expect(result.sessions[0]).toMatchObject({
      agentId: "main",
      key: "agent:main:slack:channel:c0000",
      kind: "group",
      sessionId: "synthetic-0",
    });
  });

  it("keeps display child links from a prebuilt list index without lightweight fallback scans", () => {
    const now = Date.now();
    const parentKey = "agent:main:dashboard:parent";
    const childKey = "agent:main:dashboard:child";
    const store: Record<string, SessionEntry> = {
      [parentKey]: {
        sessionId: "parent",
        updatedAt: now,
      },
      [childKey]: {
        sessionId: "child",
        updatedAt: now - 1,
        parentSessionKey: parentKey,
      },
    };

    const lightweightRowWithoutListIndex = buildGatewaySessionRow({
      cfg,
      storePath: "/tmp/openclaw-session-list-baseline/sessions.json",
      store,
      key: parentKey,
      entry: store[parentKey],
      now,
      lightweightListRow: true,
      skipTranscriptUsageFallback: true,
    });
    expect(lightweightRowWithoutListIndex.childSessions).toBeUndefined();

    const displayList = listSessionsFromStore({
      cfg,
      storePath: "/tmp/openclaw-session-list-baseline/sessions.json",
      store,
      opts: { projectionTier: "display" },
    });
    const parent = displayList.sessions.find((session) => session.key === parentKey);
    expect(parent?.childSessions).toEqual([childKey]);
  });
});
