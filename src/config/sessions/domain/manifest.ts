import type { SessionEntry } from "../types.js";
import { projectSessionEntry, type SessionDisplayProjection } from "./projection.js";

export type SessionTranscriptManifest = {
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  updatedAt: number;
  transcriptBytes?: number;
  entryCount?: number;
  firstEntryAt?: number;
  lastEntryAt?: number;
  missingTranscript: boolean;
  repairedAt?: number;
};

export type SessionProjectionIndexEntry = {
  manifest: SessionTranscriptManifest;
  display: SessionDisplayProjection;
};

export function buildTranscriptManifest(params: {
  sessionKey: string;
  entry: SessionEntry;
  transcriptBytes?: number;
  entryCount?: number;
  firstEntryAt?: number;
  lastEntryAt?: number;
  transcriptExists?: boolean;
  repairedAt?: number;
}): SessionTranscriptManifest {
  return {
    sessionKey: params.sessionKey,
    sessionId: params.entry.sessionId,
    sessionFile: params.entry.sessionFile,
    updatedAt: params.entry.updatedAt,
    transcriptBytes: params.transcriptBytes,
    entryCount: params.entryCount,
    firstEntryAt: params.firstEntryAt,
    lastEntryAt: params.lastEntryAt,
    missingTranscript: params.entry.sessionFile ? params.transcriptExists === false : false,
    repairedAt: params.repairedAt,
  };
}

export function buildProjectionIndexEntry(params: {
  sessionKey: string;
  entry: SessionEntry;
  manifest: SessionTranscriptManifest;
}): SessionProjectionIndexEntry {
  return {
    manifest: params.manifest,
    display: projectSessionEntry(params.sessionKey, params.entry, "display"),
  };
}
