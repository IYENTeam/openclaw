import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../../test-helpers/temp-dir.js";
import {
  clearSessionStoreCacheForTest,
  loadSessionStore,
  updateLastRoute,
  updateSessionStore,
  updateSessionStoreEntry,
} from "../sessions.js";
import { applySessionStoreMigrations } from "./store-migrations.js";
import type { SessionEntry } from "./types.js";

const CANONICAL_CASE_KEY = "agent:main:webchat:direct:mixed-user";
const MIXED_CASE_KEY = "Agent:Main:WebChat:Direct:MiXeD-User";
const MISSING_TRANSCRIPT_KEY = "agent:main:slack:channel:c-missing";
const PLUGIN_KEY = "agent:main:plugin:runtime:demo";
const ACP_KEY = "agent:main:acp:workspace-1";
const SUBAGENT_KEY = "agent:main:subagent:child-1";
const HEARTBEAT_KEY = "agent:main:slack:channel:c123:heartbeat";
const CRON_RUN_KEY = "agent:main:cron:daily-report:run:run-1";
const ARCHIVE_KEY = "agent:main:archive:reset-demo";
const MODEL_OVERRIDE_KEY = "agent:main:telegram:direct:u1";

function entry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: overrides.sessionId ?? "sid-base",
    updatedAt: overrides.updatedAt ?? Date.now(),
    ...overrides,
  };
}

function createLegacyCompatibilityStore(): Record<string, SessionEntry> {
  return {
    [MIXED_CASE_KEY]: entry({
      sessionId: "case-session",
      updatedAt: 20,
      chatType: "direct",
      channel: "webchat",
      origin: { provider: "webchat", chatType: "direct", from: "WebChat:MiXeD-User" },
    }),
    [MISSING_TRANSCRIPT_KEY]: entry({
      sessionId: "missing-transcript",
      sessionFile: "sessions/missing-transcript.jsonl",
      channel: "slack",
      chatType: "channel",
    }),
    [PLUGIN_KEY]: entry({
      sessionId: "plugin-runtime",
      pluginOwnerId: "demo-plugin",
      pluginExtensions: {
        "demo-plugin": {
          privateState: { version: 1, nested: ["keep", "unknown"] },
        },
      },
      pluginNextTurnInjections: {
        "demo-plugin": [
          {
            id: "inject-1",
            pluginId: "demo-plugin",
            text: "next turn",
            placement: "append_context",
            createdAt: 10,
          },
        ],
      },
    }),
    [ACP_KEY]: entry({
      sessionId: "acp-session",
      acp: {
        backend: "codex",
        agent: "main",
        runtimeSessionName: "workspace-1",
        mode: "persistent",
        cwd: "/tmp/openclaw-test-workspace",
        state: "running",
        lastActivityAt: 11,
        identity: {
          state: "resolved",
          acpxRecordId: "record-1",
          acpxSessionId: "acpx-1",
          agentSessionId: "agent-session-1",
          source: "event",
          lastUpdatedAt: 12,
        },
      },
    }),
    [SUBAGENT_KEY]: entry({
      sessionId: "subagent-child",
      spawnedBy: "agent:main:slack:channel:c123",
      spawnedWorkspaceDir: "/tmp/openclaw-child-workspace",
      parentSessionKey: "agent:main:slack:channel:c123",
      forkedFromParent: true,
      spawnDepth: 1,
      subagentRole: "leaf",
      subagentControlScope: "none",
      status: "done",
    }),
    [HEARTBEAT_KEY]: entry({
      sessionId: "heartbeat-child",
      heartbeatIsolatedBaseSessionKey: "agent:main:slack:channel:c123",
      lastHeartbeatText: "still alive",
      lastHeartbeatSentAt: 15,
      heartbeatTaskState: { ping: 15 },
    }),
    [CRON_RUN_KEY]: entry({
      sessionId: "cron-run",
      status: "timeout",
      startedAt: 30,
      endedAt: 40,
      runtimeMs: 10,
    }),
    [ARCHIVE_KEY]: entry({
      sessionId: "archived-reset",
      sessionFile: "archive/reset/archived-reset.jsonl",
      status: "killed",
    }),
    [MODEL_OVERRIDE_KEY]: entry({
      sessionId: "model-override",
      providerOverride: "openai",
      modelOverride: "gpt-5.4",
      modelOverrideSource: "user",
      authProfileOverride: "work",
      authProfileOverrideSource: "user",
      thinkingLevel: "high",
      fastMode: true,
      liveModelSwitchPending: true,
    }),
  };
}

async function writeFixtureStore(storePath: string): Promise<Record<string, SessionEntry>> {
  const store = createLegacyCompatibilityStore();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  clearSessionStoreCacheForTest();
  return store;
}

describe("legacy session compatibility fixtures", () => {
  it("loads and preserves the legacy edge-case fixture set", async () => {
    await withTempDir({ prefix: "openclaw-legacy-session-fixtures-" }, async (dir) => {
      const storePath = path.join(dir, "sessions.json");
      const fixture = await writeFixtureStore(storePath);
      await fs.mkdir(path.join(dir, "sessions"), { recursive: true });
      await fs.writeFile(path.join(dir, "sessions", "transcript-only.jsonl"), "{}\n", "utf8");

      const loaded = loadSessionStore(storePath, {
        skipCache: true,
        maintenanceConfig: {
          mode: "warn",
          pruneAfterMs: 0,
          maxEntries: 1000,
          resetArchiveRetentionMs: null,
          maxDiskBytes: null,
          highWaterBytes: null,
        },
      });

      expect(Object.keys(loaded)).toHaveLength(9);
      expect(loaded[MIXED_CASE_KEY]).toMatchObject(fixture[MIXED_CASE_KEY]!);
      expect(loaded[PLUGIN_KEY]?.pluginExtensions).toEqual(fixture[PLUGIN_KEY]?.pluginExtensions);
      expect(loaded[ACP_KEY]?.acp).toEqual(fixture[ACP_KEY]?.acp);
      expect(loaded[SUBAGENT_KEY]).toMatchObject({
        spawnedBy: "agent:main:slack:channel:c123",
        parentSessionKey: "agent:main:slack:channel:c123",
        spawnDepth: 1,
      });
      expect(loaded[HEARTBEAT_KEY]?.heartbeatTaskState).toEqual({ ping: 15 });
      expect(loaded[CRON_RUN_KEY]?.status).toBe("timeout");
      expect(loaded[ARCHIVE_KEY]?.sessionFile).toBe("archive/reset/archived-reset.jsonl");
      expect(loaded[MODEL_OVERRIDE_KEY]).toMatchObject({
        modelOverride: "gpt-5.4",
        modelOverrideSource: "user",
        authProfileOverride: "work",
      });
      await expect(
        fs.stat(path.join(dir, "sessions", "transcript-only.jsonl")),
      ).resolves.toBeDefined();
    });
  });

  it("resolves legacy case aliases to the canonical store key without data loss", async () => {
    await withTempDir({ prefix: "openclaw-legacy-case-alias-" }, async (dir) => {
      const storePath = path.join(dir, "sessions.json");
      await writeFixtureStore(storePath);

      await updateLastRoute({
        storePath,
        sessionKey: CANONICAL_CASE_KEY,
        channel: "webchat",
        to: "webchat:mixed-user",
      });

      const loaded = loadSessionStore(storePath, { skipCache: true });
      expect(loaded[MIXED_CASE_KEY]).toBeUndefined();
      expect(loaded[CANONICAL_CASE_KEY]).toMatchObject({
        sessionId: "case-session",
        lastChannel: "webchat",
        lastTo: "webchat:mixed-user",
        origin: { provider: "webchat" },
      });
    });
  });

  it("preserves plugin extension state and ACP metadata through update paths", async () => {
    await withTempDir({ prefix: "openclaw-legacy-extension-preserve-" }, async (dir) => {
      const storePath = path.join(dir, "sessions.json");
      const fixture = await writeFixtureStore(storePath);

      await updateSessionStoreEntry({
        storePath,
        sessionKey: PLUGIN_KEY,
        update: async () => ({ label: "Plugin runtime" }),
      });
      await updateSessionStoreEntry({
        storePath,
        sessionKey: ACP_KEY,
        update: async () => ({ updatedAt: 99 }),
      });

      const loaded = loadSessionStore(storePath, { skipCache: true });
      expect(loaded[PLUGIN_KEY]?.pluginExtensions).toEqual(fixture[PLUGIN_KEY]?.pluginExtensions);
      expect(loaded[PLUGIN_KEY]?.pluginNextTurnInjections).toEqual(
        fixture[PLUGIN_KEY]?.pluginNextTurnInjections,
      );
      expect(loaded[PLUGIN_KEY]?.label).toBe("Plugin runtime");
      expect(loaded[ACP_KEY]?.acp).toEqual(fixture[ACP_KEY]?.acp);
    });
  });

  it("keeps missing transcript references non-destructive until cleanup explicitly runs", async () => {
    await withTempDir({ prefix: "openclaw-missing-transcript-preserve-" }, async (dir) => {
      const storePath = path.join(dir, "sessions.json");
      await writeFixtureStore(storePath);

      await updateSessionStoreEntry({
        storePath,
        sessionKey: MISSING_TRANSCRIPT_KEY,
        update: async () => ({ label: "Missing transcript remains referenced" }),
      });

      const loaded = loadSessionStore(storePath, { skipCache: true });
      expect(loaded[MISSING_TRANSCRIPT_KEY]).toMatchObject({
        sessionId: "missing-transcript",
        sessionFile: "sessions/missing-transcript.jsonl",
        label: "Missing transcript remains referenced",
      });
      await expect(
        fs.stat(path.join(dir, "sessions", "missing-transcript.jsonl")),
      ).rejects.toThrow();
    });
  });
  it("keeps store migrations idempotent and preserves unknown compatibility fields", () => {
    const legacyEntry = {
      sessionId: "legacy-migration",
      updatedAt: 1,
      provider: "slack",
      lastProvider: "slack",
      room: "legacy-room",
      pluginExtensions: {
        unknownPlugin: { state: { nested: true } },
      },
      acp: { sessionId: "acp-session", mode: "attached" },
      futureDomainView: { version: 99, owner: "external" },
    } as unknown as SessionEntry;
    const store: Record<string, SessionEntry> = {
      "agent:main:legacy:migration": legacyEntry,
    };

    expect(applySessionStoreMigrations(store)).toBe(true);
    expect(applySessionStoreMigrations(store)).toBe(false);
    expect(store["agent:main:legacy:migration"]).toMatchObject({
      channel: "slack",
      lastChannel: "slack",
      groupChannel: "legacy-room",
      pluginExtensions: {
        unknownPlugin: { state: { nested: true } },
      },
      acp: { sessionId: "acp-session", mode: "attached" },
      futureDomainView: { version: 99, owner: "external" },
    });
    expect(
      "provider" in (store["agent:main:legacy:migration"] as unknown as Record<string, unknown>),
    ).toBe(false);
    expect(
      "lastProvider" in
        (store["agent:main:legacy:migration"] as unknown as Record<string, unknown>),
    ).toBe(false);
    expect(
      "room" in (store["agent:main:legacy:migration"] as unknown as Record<string, unknown>),
    ).toBe(false);
  });

  it("loads migration candidates without mutating disk until an explicit save path runs", async () => {
    await withTempDir({ prefix: "openclaw-session-migration-dry-run-" }, async (dir) => {
      const storePath = path.join(dir, "sessions.json");
      const rawStore = {
        "agent:main:legacy:dry-run": {
          sessionId: "dry-run",
          updatedAt: 1,
          provider: "discord",
          room: "general",
          unknownCompatibilityBlock: { keep: ["yes"] },
        },
      };
      const before = `${JSON.stringify(rawStore, null, 2)}\n`;
      await fs.writeFile(storePath, before, "utf8");

      const loaded = loadSessionStore(storePath, { skipCache: true });
      const after = await fs.readFile(storePath, "utf8");

      expect(loaded["agent:main:legacy:dry-run"]).toMatchObject({
        channel: "discord",
        groupChannel: "general",
        unknownCompatibilityBlock: { keep: ["yes"] },
      });
      expect(after).toBe(before);
    });
  });
});
