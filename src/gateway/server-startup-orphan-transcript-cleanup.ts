import fs from "node:fs";
import path from "node:path";
import { listAgentIds } from "../agents/agent-scope.js";
import {
  formatSessionArchiveTimestamp,
  isPrimarySessionTranscriptFileName,
} from "../config/sessions/artifacts.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptsDirForAgent,
  resolveStorePath,
} from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store-load.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

type OrphanTranscriptCleanupLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

function resolveComparableTranscriptPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

/**
 * Run orphan transcript cleanup at gateway startup.
 *
 * Idempotent and best-effort: if the cleanup fails, gateway startup
 * continues normally. This ensures orphaned transcript files (no longer
 * referenced in sessions.json) are archived automatically on startup
 * rather than accumulating indefinitely.
 */
export async function runStartupOrphanTranscriptCleanup(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  log: OrphanTranscriptCleanupLogger;
}): Promise<void> {
  const env = params.env ?? process.env;
  let totalArchived = 0;

  try {
    const agentIds = listAgentIds(params.cfg);

    for (const agentId of agentIds) {
      try {
        const sessionsDir = resolveSessionTranscriptsDirForAgent(agentId, env);
        const storePath = resolveStorePath(params.cfg.session?.store, { agentId, env });

        if (!fs.existsSync(sessionsDir)) {
          continue;
        }

        if (!fs.existsSync(storePath)) {
          continue;
        }

        const store = loadSessionStore(storePath, { skipCache: true });
        const entries = Object.entries(store);

        const sessionPathOpts = resolveSessionFilePathOptions({ agentId, storePath });
        const referencedTranscriptPaths = new Set<string>();
        for (const [, entry] of entries) {
          if (!entry?.sessionId) {
            continue;
          }
          try {
            referencedTranscriptPaths.add(
              resolveComparableTranscriptPath(
                resolveSessionFilePath(entry.sessionId, entry, sessionPathOpts),
              ),
            );
          } catch {
            // ignore invalid legacy paths
          }
        }

        const sessionDirEntries = fs.readdirSync(sessionsDir, { withFileTypes: true });
        const orphanTranscriptPaths = sessionDirEntries
          .filter((entry) => entry.isFile() && isPrimarySessionTranscriptFileName(entry.name))
          .map((entry) => path.join(sessionsDir, entry.name))
          .filter(
            (filePath) => !referencedTranscriptPaths.has(resolveComparableTranscriptPath(filePath)),
          );

        const timestamp = formatSessionArchiveTimestamp();
        for (const orphanPath of orphanTranscriptPaths) {
          try {
            const archivedPath = `${orphanPath}.deleted.${timestamp}`;
            fs.renameSync(orphanPath, archivedPath);
            totalArchived += 1;
          } catch (err) {
            params.log.warn(
              `gateway: failed to archive orphan transcript ${orphanPath}: ${String(err)}`,
            );
          }
        }
      } catch (err) {
        params.log.warn(
          `gateway: orphan transcript cleanup failed for agent ${agentId}; continuing: ${String(err)}`,
        );
      }
    }

    if (totalArchived > 0) {
      params.log.info(
        `gateway: archived ${totalArchived} orphan transcript file${totalArchived === 1 ? "" : "s"}`,
      );
    }
  } catch (err) {
    params.log.warn(
      `gateway: orphan transcript cleanup failed during startup; continuing: ${String(err)}`,
    );
  }
}
