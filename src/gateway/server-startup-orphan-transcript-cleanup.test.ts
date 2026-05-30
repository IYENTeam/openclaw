import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { runStartupOrphanTranscriptCleanup } from "./server-startup-orphan-transcript-cleanup.js";

describe("runStartupOrphanTranscriptCleanup", () => {
  let tmpDir: string;
  let stateDir: string;
  let sessionsDir: string;
  let storePath: string;
  let cfg: OpenClawConfig;
  const logs: Array<{ level: string; message: string }> = [];

  const logger = {
    info: (message: string) => logs.push({ level: "info", message }),
    warn: (message: string) => logs.push({ level: "warn", message }),
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orphan-cleanup-test-"));
    stateDir = path.join(tmpDir, ".openclaw");
    sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    storePath = path.join(sessionsDir, "sessions.json");
    fs.mkdirSync(sessionsDir, { recursive: true });

    cfg = {};
    logs.length = 0;
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should archive orphan transcripts", async () => {
    fs.writeFileSync(path.join(sessionsDir, "session-1.jsonl"), "");
    fs.writeFileSync(path.join(sessionsDir, "session-2.jsonl"), "");
    fs.writeFileSync(storePath, JSON.stringify({}));

    await runStartupOrphanTranscriptCleanup({
      cfg,
      env: { OPENCLAW_STATE_DIR: stateDir },
      log: logger,
    });

    const files = fs.readdirSync(sessionsDir);
    const archivedFiles = files.filter((f) => f.includes(".deleted."));
    expect(archivedFiles.length).toBe(2);
    expect(logs.some((log) => log.level === "info" && log.message.includes("archived 2"))).toBe(
      true,
    );
  });

  it("should NOT archive referenced transcripts", async () => {
    fs.writeFileSync(path.join(sessionsDir, "session-1.jsonl"), "");
    fs.writeFileSync(path.join(sessionsDir, "session-2.jsonl"), "");
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        "session-1": { sessionId: "session-1" },
      }),
    );

    await runStartupOrphanTranscriptCleanup({
      cfg,
      env: { OPENCLAW_STATE_DIR: stateDir },
      log: logger,
    });

    const files = fs.readdirSync(sessionsDir);
    expect(files.includes("session-1.jsonl")).toBe(true);
    const archivedFiles = files.filter((f) => f.includes(".deleted."));
    expect(archivedFiles.length).toBe(1);
    expect(logs.some((log) => log.level === "info" && log.message.includes("archived 1"))).toBe(
      true,
    );
  });

  it("should continue on errors without crashing", async () => {
    fs.writeFileSync(path.join(sessionsDir, "session-1.jsonl"), "");
    fs.writeFileSync(storePath, "invalid json");

    await runStartupOrphanTranscriptCleanup({
      cfg,
      env: { OPENCLAW_STATE_DIR: stateDir },
      log: logger,
    });

    const files = fs.readdirSync(sessionsDir);
    const archivedFiles = files.filter((f) => f.includes(".deleted."));
    expect(archivedFiles.length).toBe(1);
  });

  it("should handle missing sessionsDir gracefully", async () => {
    fs.rmSync(sessionsDir, { recursive: true, force: true });

    await runStartupOrphanTranscriptCleanup({
      cfg,
      env: { OPENCLAW_STATE_DIR: stateDir },
      log: logger,
    });

    expect(logs.filter((log) => log.level === "warn").length).toBe(0);
  });

  it("should handle individual file rename failures", async () => {
    fs.writeFileSync(path.join(sessionsDir, "session-1.jsonl"), "");
    fs.writeFileSync(path.join(sessionsDir, "session-2.jsonl"), "");
    fs.writeFileSync(storePath, JSON.stringify({}));

    const originalRenameSync = fs.renameSync;
    let callCount = 0;
    fs.renameSync = ((src: string, dest: string) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("Simulated rename failure");
      }
      return originalRenameSync(src, dest);
    }) as typeof fs.renameSync;

    try {
      await runStartupOrphanTranscriptCleanup({
        cfg,
        env: { OPENCLAW_STATE_DIR: stateDir },
        log: logger,
      });

      expect(
        logs.some((log) => log.level === "warn" && log.message.includes("failed to archive")),
      ).toBe(true);
      expect(logs.some((log) => log.level === "info" && log.message.includes("archived 1"))).toBe(
        true,
      );
    } finally {
      fs.renameSync = originalRenameSync;
    }
  });
});
