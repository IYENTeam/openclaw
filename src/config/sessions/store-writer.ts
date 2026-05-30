import fsSync from "node:fs";
import path from "node:path";
import { withSessionStoreFileLock } from "./store-file-lock.js";
import {
  WRITER_QUEUES,
  type SessionStoreWriterQueue,
  type SessionStoreWriterTask,
} from "./store-writer-state.js";

export async function withSessionStoreWriterForTest<T>(
  storePath: string,
  fn: (resolvedStorePath: string) => Promise<T>,
): Promise<T> {
  return await runExclusiveSessionStoreWrite(storePath, fn);
}

function resolveSessionStoreWriterKey(storePath: string): string {
  const resolved = path.resolve(storePath);
  try {
    return fsSync.realpathSync.native(resolved);
  } catch {
    const dir = path.dirname(resolved);
    try {
      return path.join(fsSync.realpathSync.native(dir), path.basename(resolved));
    } catch {
      return resolved;
    }
  }
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
  fn: (resolvedStorePath: string) => Promise<T>,
): Promise<T> {
  if (!storePath || typeof storePath !== "string") {
    throw new Error(
      `runExclusiveSessionStoreWrite: storePath must be a non-empty string, got ${JSON.stringify(
        storePath,
      )}`,
    );
  }
  const writerKey = resolveSessionStoreWriterKey(storePath);
  const queue = getOrCreateWriterQueue(writerKey);

  const promise = new Promise<T>((resolve, reject) => {
    const task: SessionStoreWriterTask = {
      fn: async () => await fn(writerKey),
      resolve: (value) => resolve(value as T),
      reject,
    };

    queue.pending.push(task);
    void drainSessionStoreWriterQueue(writerKey);
  });

  return await promise;
}
