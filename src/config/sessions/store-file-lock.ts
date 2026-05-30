import path from "node:path";
import {
  acquireSessionWriteLock,
  resolveSessionLockMaxHoldFromTimeout,
  resolveSessionWriteLockAcquireTimeoutMs,
} from "../../agents/session-write-lock.js";

export type SessionStoreFileLockOptions = {
  timeoutMs?: number;
  staleMs?: number;
  maxHoldMs?: number;
};

type SessionStoreFileLock = {
  release: () => Promise<void>;
};

let testLockOptions: SessionStoreFileLockOptions | null = null;

function resolveLockOptions(
  options?: SessionStoreFileLockOptions,
): Required<SessionStoreFileLockOptions> {
  const merged = { ...testLockOptions, ...options };
  const timeoutMs = merged.timeoutMs ?? resolveSessionWriteLockAcquireTimeoutMs();
  return {
    timeoutMs,
    staleMs: merged.staleMs ?? 30 * 60 * 1000,
    maxHoldMs: merged.maxHoldMs ?? resolveSessionLockMaxHoldFromTimeout({ timeoutMs }),
  };
}

export function resolveSessionStoreFileLockPath(storePath: string): string {
  return `${path.resolve(storePath)}.lock`;
}

export async function acquireSessionStoreFileLock(params: {
  storePath: string;
  options?: SessionStoreFileLockOptions;
}): Promise<SessionStoreFileLock> {
  const options = resolveLockOptions(params.options);
  return await acquireSessionWriteLock({
    sessionFile: params.storePath,
    timeoutMs: options.timeoutMs,
    staleMs: options.staleMs,
    maxHoldMs: options.maxHoldMs,
    allowReentrant: true,
  });
}

export async function withSessionStoreFileLock<T>(
  storePath: string,
  fn: () => Promise<T>,
  options?: SessionStoreFileLockOptions,
): Promise<T> {
  const lock = await acquireSessionStoreFileLock({ storePath, options });
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

export const __testing = {
  setSessionStoreFileLockOptionsForTest(options: SessionStoreFileLockOptions | null): void {
    testLockOptions = options;
  },
};
