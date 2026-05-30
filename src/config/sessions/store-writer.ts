import fs from "node:fs/promises";
import path from "node:path";
import { withSessionStoreFileLock } from "./store-file-lock.js";
import {
  WRITER_QUEUES,
  type SessionStoreWriterQueue,
  type SessionStoreWriterTask,
} from "./store-writer-state.js";

export async function withSessionStoreWriterForTest<T>(
  storePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  return await runExclusiveSessionStoreWrite(storePath, fn);
}

async function resolveSessionStoreWriterKey(storePath: string): Promise<string> {
  const resolved = path.resolve(storePath);
  const realFile = await fs.realpath(resolved).catch(() => null);
  if (realFile) {
    return realFile;
  }
  const dir = path.dirname(resolved);
  const realDir = await fs.realpath(dir).catch(() => dir);
  return path.join(realDir, path.basename(resolved));
}

function getOrCreateWriterQueue(storePath: string): SessionStoreWriterQueue {
  const existing = WRITER_QUEUES.get(storePath);
  if (existing) {
    return existing;
  }
  const created: SessionStoreWriterQueue = { running: false, pending: [], drainPromise: null };
  WRITER_QUEUES.set(storePath, created);
  return created;
}

async function drainSessionStoreWriterQueue(storePath: string): Promise<void> {
  const queue = WRITER_QUEUES.get(storePath);
  if (!queue) {
    return;
  }
  if (queue.drainPromise) {
    await queue.drainPromise;
    return;
  }
  queue.running = true;
  queue.drainPromise = (async () => {
    try {
      while (queue.pending.length > 0) {
        const task = queue.pending.shift();
        if (!task) {
          continue;
        }

        let result: unknown;
        let failed: unknown;
        let hasFailure = false;
        try {
          result = await withSessionStoreFileLock(storePath, task.fn);
        } catch (err) {
          hasFailure = true;
          failed = err;
        }
        if (hasFailure) {
          task.reject(failed);
          continue;
        }
        task.resolve(result);
      }
    } finally {
      queue.running = false;
      queue.drainPromise = null;
      if (queue.pending.length === 0) {
        WRITER_QUEUES.delete(storePath);
      } else {
        queueMicrotask(() => {
          void drainSessionStoreWriterQueue(storePath);
        });
      }
    }
  })();
  await queue.drainPromise;
}

export async function runExclusiveSessionStoreWrite<T>(
  storePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!storePath || typeof storePath !== "string") {
    throw new Error(
      `runExclusiveSessionStoreWrite: storePath must be a non-empty string, got ${JSON.stringify(
        storePath,
      )}`,
    );
  }
  const writerKey = await resolveSessionStoreWriterKey(storePath);
  const queue = getOrCreateWriterQueue(writerKey);

  const promise = new Promise<T>((resolve, reject) => {
    const task: SessionStoreWriterTask = {
      fn: async () => await fn(),
      resolve: (value) => resolve(value as T),
      reject,
    };

    queue.pending.push(task);
    void drainSessionStoreWriterQueue(writerKey);
  });

  return await promise;
}
