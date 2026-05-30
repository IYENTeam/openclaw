import fs from "node:fs";
import path from "node:path";
import { formatSessionArchiveTimestamp, isPrimarySessionTranscriptFileName } from "./artifacts.js";
import { resolveSessionFilePath, type SessionFilePathOptions } from "./paths.js";
import type { SessionEntry } from "./types.js";

/**
 * Resolve a transcript file path to a comparable canonical form.
 * Uses native realpath when available, falls back to path.resolve.
 */
export function resolveComparableTranscriptPath(filePath: string): string {
  return tryResolveNativeRealPath(filePath) ?? path.resolve(filePath);
}

/**
 * Attempt to resolve the real path using fs.realpathSync.native.
 * Returns null if the path cannot be resolved.
 */
function tryResolveNativeRealPath(filePath: string): string | null {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return null;
  }
}

/**
 * Build a set of transcript file paths that are referenced by session store entries.
 */
export function buildReferencedTranscriptPaths(params: {
  entries: Iterable<[string, SessionEntry | undefined]>;
  sessionPathOpts: SessionFilePathOptions;
}): Set<string> {
  const referencedTranscriptPaths = new Set<string>();
  for (const [, entry] of params.entries) {
    if (!entry?.sessionId) {
      continue;
    }
    try {
      referencedTranscriptPaths.add(
        resolveComparableTranscriptPath(
          resolveSessionFilePath(entry.sessionId, entry, params.sessionPathOpts),
        ),
      );
    } catch {
      // ignore invalid legacy paths
    }
  }
  return referencedTranscriptPaths;
}

/**
 * Find orphan transcript files in a sessions directory.
 * Returns absolute paths of .jsonl files not referenced by any session entry.
 */
export function findOrphanTranscriptPaths(params: {
  sessionsDir: string;
  referencedTranscriptPaths: Set<string>;
}): string[] {
  try {
    const sessionDirEntries = fs.readdirSync(params.sessionsDir, { withFileTypes: true });
    return sessionDirEntries
      .filter((entry) => entry.isFile() && isPrimarySessionTranscriptFileName(entry.name))
      .map((entry) => path.join(params.sessionsDir, entry.name))
      .filter(
        (filePath) =>
          !params.referencedTranscriptPaths.has(resolveComparableTranscriptPath(filePath)),
      );
  } catch {
    return [];
  }
}

/**
 * Archive orphan transcripts by renaming them to *.deleted.<timestamp>.
 * Returns count of successfully archived files and any errors encountered.
 */
export function archiveOrphanTranscripts(params: { orphanPaths: string[]; timestamp?: string }): {
  archived: number;
  errors: string[];
} {
  const timestamp = params.timestamp ?? formatSessionArchiveTimestamp();
  let archived = 0;
  const errors: string[] = [];

  for (const orphanPath of params.orphanPaths) {
    const archivedPath = `${orphanPath}.deleted.${timestamp}`;
    try {
      fs.renameSync(orphanPath, archivedPath);
      archived += 1;
    } catch (err) {
      errors.push(`Failed to archive ${orphanPath}: ${String(err)}`);
    }
  }

  return { archived, errors };
}
