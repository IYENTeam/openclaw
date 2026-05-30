import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveOrphanTranscripts,
  buildReferencedTranscriptPaths,
  findOrphanTranscriptPaths,
  resolveComparableTranscriptPath,
} from "./orphan-transcript-utils.js";
import type { SessionEntry } from "./types.js";

describe("orphan-transcript-utils", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "orphan-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("resolveComparableTranscriptPath", () => {
    it("should resolve to absolute path", () => {
      const testFile = path.join(tempDir, "test.jsonl");
      fs.writeFileSync(testFile, "");
      const resolved = resolveComparableTranscriptPath(testFile);
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toContain("test.jsonl");
    });

    it("should resolve symlinks to real path when file exists", () => {
      const realFile = path.join(tempDir, "real.jsonl");
      const linkFile = path.join(tempDir, "link.jsonl");
      fs.writeFileSync(realFile, "");
      fs.symlinkSync(realFile, linkFile);

      const resolvedLink = resolveComparableTranscriptPath(linkFile);
      const resolvedReal = resolveComparableTranscriptPath(realFile);

      expect(resolvedLink).toBe(resolvedReal);
      expect(resolvedLink).toContain("real.jsonl");
    });

    it("should fall back to path.resolve for non-existent files", () => {
      const nonExistent = path.join(tempDir, "nonexistent.jsonl");
      const resolved = resolveComparableTranscriptPath(nonExistent);
      expect(resolved).toBe(path.resolve(nonExistent));
    });
  });

  describe("buildReferencedTranscriptPaths", () => {
    it("should build set of referenced transcript paths", () => {
      const session1 = path.join(tempDir, "session1.jsonl");
      const session2 = path.join(tempDir, "session2.jsonl");
      fs.writeFileSync(session1, "");
      fs.writeFileSync(session2, "");

      const entries: Array<[string, SessionEntry]> = [
        ["key1", { sessionId: "session1", updatedAt: Date.now() }],
        ["key2", { sessionId: "session2", updatedAt: Date.now() }],
      ];

      const referenced = buildReferencedTranscriptPaths({
        entries,
        sessionPathOpts: { sessionsDir: tempDir },
      });

      expect(referenced.size).toBe(2);
      expect(referenced.has(resolveComparableTranscriptPath(session1))).toBe(true);
      expect(referenced.has(resolveComparableTranscriptPath(session2))).toBe(true);
    });

    it("should skip entries without sessionId", () => {
      const entries: Array<[string, SessionEntry | undefined]> = [
        ["key1", undefined],
        ["key2", { sessionId: "", updatedAt: Date.now() }],
      ];

      const referenced = buildReferencedTranscriptPaths({
        entries,
        sessionPathOpts: { sessionsDir: tempDir },
      });

      expect(referenced.size).toBe(0);
    });

    it("should handle entries with custom sessionFile paths", () => {
      const customPath = path.join(tempDir, "custom.jsonl");
      fs.writeFileSync(customPath, "");

      const entries: Array<[string, SessionEntry]> = [
        ["key1", { sessionId: "session1", sessionFile: customPath, updatedAt: Date.now() }],
      ];

      const referenced = buildReferencedTranscriptPaths({
        entries,
        sessionPathOpts: { sessionsDir: tempDir },
      });

      expect(referenced.size).toBe(1);
      expect(referenced.has(resolveComparableTranscriptPath(customPath))).toBe(true);
    });
  });

  describe("findOrphanTranscriptPaths", () => {
    it("should identify orphan transcripts not in referenced set", () => {
      const session1 = path.join(tempDir, "session1.jsonl");
      const session2 = path.join(tempDir, "session2.jsonl");
      const orphan = path.join(tempDir, "orphan.jsonl");

      fs.writeFileSync(session1, "");
      fs.writeFileSync(session2, "");
      fs.writeFileSync(orphan, "");

      const referencedTranscriptPaths = new Set([
        resolveComparableTranscriptPath(session1),
        resolveComparableTranscriptPath(session2),
      ]);

      const orphans = findOrphanTranscriptPaths({
        sessionsDir: tempDir,
        referencedTranscriptPaths,
      });

      expect(orphans).toHaveLength(1);
      expect(orphans[0]).toBe(orphan);
    });

    it("should only include primary session transcript files", () => {
      const primary = path.join(tempDir, "session.jsonl");
      const archived = path.join(tempDir, "session.jsonl.deleted.2024-01-01T00-00-00.000Z");
      const checkpoint = path.join(
        tempDir,
        "session.checkpoint.12345678-1234-1234-1234-123456789abc.jsonl",
      );
      const trajectory = path.join(tempDir, "session.trajectory.jsonl");
      const storeFile = path.join(tempDir, "sessions.json");

      fs.writeFileSync(primary, "");
      fs.writeFileSync(archived, "");
      fs.writeFileSync(checkpoint, "");
      fs.writeFileSync(trajectory, "");
      fs.writeFileSync(storeFile, "{}");

      const orphans = findOrphanTranscriptPaths({
        sessionsDir: tempDir,
        referencedTranscriptPaths: new Set(),
      });

      expect(orphans).toHaveLength(1);
      expect(orphans[0]).toBe(primary);
    });

    it("should return empty array if sessions directory does not exist", () => {
      const nonExistentDir = path.join(tempDir, "nonexistent");

      const orphans = findOrphanTranscriptPaths({
        sessionsDir: nonExistentDir,
        referencedTranscriptPaths: new Set(),
      });

      expect(orphans).toEqual([]);
    });
  });

  describe("archiveOrphanTranscripts", () => {
    it("should archive orphan transcripts with correct suffix", () => {
      const orphan1 = path.join(tempDir, "orphan1.jsonl");
      const orphan2 = path.join(tempDir, "orphan2.jsonl");

      fs.writeFileSync(orphan1, "content1");
      fs.writeFileSync(orphan2, "content2");

      const timestamp = "2024-01-01T00-00-00.000Z";
      const result = archiveOrphanTranscripts({
        orphanPaths: [orphan1, orphan2],
        timestamp,
      });

      expect(result.archived).toBe(2);
      expect(result.errors).toHaveLength(0);

      expect(fs.existsSync(orphan1)).toBe(false);
      expect(fs.existsSync(orphan2)).toBe(false);

      const archived1 = `${orphan1}.deleted.${timestamp}`;
      const archived2 = `${orphan2}.deleted.${timestamp}`;

      expect(fs.existsSync(archived1)).toBe(true);
      expect(fs.existsSync(archived2)).toBe(true);
      expect(fs.readFileSync(archived1, "utf-8")).toBe("content1");
      expect(fs.readFileSync(archived2, "utf-8")).toBe("content2");
    });

    it("should use formatSessionArchiveTimestamp when timestamp not provided", () => {
      const orphan = path.join(tempDir, "orphan.jsonl");
      fs.writeFileSync(orphan, "");

      const result = archiveOrphanTranscripts({
        orphanPaths: [orphan],
      });

      expect(result.archived).toBe(1);

      const files = fs.readdirSync(tempDir);
      const archivedFile = files.find((f) => f.startsWith("orphan.jsonl.deleted."));
      expect(archivedFile).toBeDefined();
      expect(archivedFile).toMatch(/orphan\.jsonl\.deleted\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    });

    it("should collect errors for files that cannot be archived", () => {
      const nonExistent = path.join(tempDir, "nonexistent.jsonl");
      const validFile = path.join(tempDir, "valid.jsonl");
      fs.writeFileSync(validFile, "");

      const result = archiveOrphanTranscripts({
        orphanPaths: [nonExistent, validFile],
        timestamp: "2024-01-01T00-00-00.000Z",
      });

      expect(result.archived).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(nonExistent);
    });

    it("should handle empty orphan list", () => {
      const result = archiveOrphanTranscripts({
        orphanPaths: [],
      });

      expect(result.archived).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});
