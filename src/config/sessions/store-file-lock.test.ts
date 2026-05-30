import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SessionWriteLockTimeoutError,
  isSessionWriteLockTimeoutError,
} from "../../agents/session-write-lock-error.js";
import {
  drainSessionWriteLockStateForTest,
  resetSessionWriteLockStateForTest,
} from "../../agents/session-write-lock.js";
import {
  __testing,
  resolveSessionStoreFileLockPath,
  withSessionStoreFileLock,
} from "./store-file-lock.js";
import { saveSessionStore, updateSessionStoreEntry } from "./store.js";
import type { SessionEntry } from "./types.js";

async function withTempStore(run: (params: { dir: string; storePath: string }) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-store-lock-"));
  try {
    await run({ dir, storePath: path.join(dir, "sessions.json") });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function readStore(storePath: string): Promise<Record<string, SessionEntry>> {
  return JSON.parse(await fs.readFile(storePath, "utf8")) as Record<string, SessionEntry>;
}

async function seedStoreFile(storePath: string): Promise<void> {
  await fs.writeFile(storePath, "{}\n", "utf8");
}

async function spawnLiveLockPayloadWriter(
  lockPath: string,
): Promise<{ stop: () => Promise<void> }> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const fs=require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({pid: process.pid, createdAt: new Date().toISOString()})); console.log("ready"); setInterval(()=>{}, 1000);`,
      lockPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for child lock writer")),
      2_000,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout?.once("data", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`child lock writer exited early: ${code}`));
    });
  });
  return {
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    },
  };
}

afterEach(async () => {
  __testing.setSessionStoreFileLockOptionsForTest(null);
  resetSessionWriteLockStateForTest();
  await drainSessionWriteLockStateForTest();
});

describe("session store file lock", () => {
  it("holds a lock file while a queued store writer is running", async () => {
    await withTempStore(async ({ storePath }) => {
      await seedStoreFile(storePath);
      let releaseWriter: () => void = () => undefined;
      let signalLocked: () => void = () => undefined;
      const writerLocked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      const writerBlocker = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const writer = withSessionStoreFileLock(storePath, async () => {
        await expect(
          fs.access(resolveSessionStoreFileLockPath(storePath)),
        ).resolves.toBeUndefined();
        signalLocked();
        await writerBlocker;
        return "done";
      });

      await writerLocked;
      await expect(fs.access(resolveSessionStoreFileLockPath(storePath))).resolves.toBeUndefined();
      releaseWriter();
      await expect(writer).resolves.toBe("done");
      await expect(fs.access(resolveSessionStoreFileLockPath(storePath))).rejects.toThrow();
    });
  });

  it("times out behind a live external store lock", async () => {
    await withTempStore(async ({ storePath }) => {
      await seedStoreFile(storePath);
      __testing.setSessionStoreFileLockOptionsForTest({ timeoutMs: 20, staleMs: 60_000 });
      const childLock = await spawnLiveLockPayloadWriter(
        resolveSessionStoreFileLockPath(storePath),
      );
      try {
        await expect(saveSessionStore(storePath, {}, { skipMaintenance: true })).rejects.toSatisfy(
          (err: unknown) => {
            expect(isSessionWriteLockTimeoutError(err)).toBe(true);
            expect(err).toBeInstanceOf(SessionWriteLockTimeoutError);
            return true;
          },
        );
      } finally {
        await childLock.stop();
      }
    });
  });

  it("reclaims stale dead-pid store locks and writes valid JSON", async () => {
    await withTempStore(async ({ storePath }) => {
      const lockPath = resolveSessionStoreFileLockPath(storePath);
      await fs.writeFile(
        lockPath,
        JSON.stringify({ pid: 9_999_999, createdAt: new Date(Date.now() - 120_000).toISOString() }),
      );
      await saveSessionStore(
        storePath,
        {
          "agent:main:main": { sessionId: "main", updatedAt: 1 } as SessionEntry,
        },
        { skipMaintenance: true },
      );

      const store = await readStore(storePath);
      expect(store["agent:main:main"]?.sessionId).toBe("main");
      await expect(fs.access(lockPath)).rejects.toThrow();
    });
  });

  it("serializes concurrent updateSessionStoreEntry calls without losing patches", async () => {
    await withTempStore(async ({ storePath }) => {
      await saveSessionStore(
        storePath,
        {
          "agent:main:main": { sessionId: "main", updatedAt: 1 } as SessionEntry,
        },
        { skipMaintenance: true },
      );

      await Promise.all([
        updateSessionStoreEntry({
          storePath,
          sessionKey: "agent:main:main",
          update: async () => ({ label: "first" }),
        }),
        updateSessionStoreEntry({
          storePath,
          sessionKey: "agent:main:main",
          update: async () => ({ updatedAt: 2 }),
        }),
      ]);

      const store = await readStore(storePath);
      expect(store["agent:main:main"]).toMatchObject({
        sessionId: "main",
        label: "first",
      });
      expect(store["agent:main:main"]?.updatedAt).toBeGreaterThanOrEqual(2);
      await fs.rm(resolveSessionStoreFileLockPath(storePath), { force: true });
    });
  });

  it("serializes in-process writers that address the same store through a symlink", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-store-lock-alias-"));
    const storePath = path.join(dir, "sessions.json");
    const aliasStorePath = path.join(dir, "sessions-alias.json");
    try {
      await saveSessionStore(
        storePath,
        {
          "agent:main:main": { sessionId: "main", updatedAt: 1 } as SessionEntry,
        },
        { skipMaintenance: true },
      );
      await fs.symlink(storePath, aliasStorePath, "file");

      const order: string[] = [];
      let releaseFirst: () => void = () => undefined;
      const firstMayFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const firstStarted = updateSessionStoreEntry({
        storePath,
        sessionKey: "agent:main:main",
        update: async () => {
          order.push("first-start");
          await firstMayFinish;
          order.push("first-end");
          return { label: "first" };
        },
      });
      await vi.waitFor(() => expect(order).toEqual(["first-start"]));
      const second = updateSessionStoreEntry({
        storePath: aliasStorePath,
        sessionKey: "agent:main:main",
        update: async () => {
          order.push("second-start");
          return { updatedAt: 2 };
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(order).toEqual(["first-start"]);
      releaseFirst();
      await Promise.all([firstStarted, second]);

      expect(order).toEqual(["first-start", "first-end", "second-start"]);
      const store = await readStore(storePath);
      expect(store["agent:main:main"]).toMatchObject({ label: "first" });
      expect(store["agent:main:main"]?.updatedAt).toBeGreaterThanOrEqual(2);
    } finally {
      await fs.unlink(aliasStorePath).catch(() => undefined);
      await fs
        .rm(resolveSessionStoreFileLockPath(storePath), { force: true })
        .catch(() => undefined);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
