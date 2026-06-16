import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, it, expect, vi } from "vitest";
import {
  externalizeToolResultMessage,
  externalizeToolResultMessageSync,
  externalizeOversizedToolResults,
} from "./tool-result-externalization.js";

function bigText(chars: number, prefix = "x"): string {
  return prefix.repeat(chars);
}

function makeToolResultMessage(
  content: unknown[],
  extra: Record<string, unknown> = {},
): AgentMessage {
  return { role: "toolResult", content, ...extra } as unknown as AgentMessage;
}

describe("externalizeToolResultMessage", () => {
  it("leaves small text blocks unchanged", async () => {
    const msg = makeToolResultMessage([{ type: "text", text: "hello" }]);
    const r = await externalizeToolResultMessage(msg);
    expect(r.externalizedBlocks).toBe(0);
    expect(r.externalizedChars).toBe(0);
    expect(r.message).toBe(msg); // 동일 reference (no copy)
  });

  it("externalizes oversized text block and preserves head + metadata", async () => {
    const original = bigText(50_000, "a");
    const msg = makeToolResultMessage([{ type: "text", text: original }]);
    const r = await externalizeToolResultMessage(msg, {
      hardCapChars: 16_000,
      headChars: 1_024,
    });
    expect(r.externalizedBlocks).toBe(1);
    expect(r.externalizedChars).toBe(50_000);
    const part = (r.message as unknown as { content: unknown[] }).content[0] as {
      type: string;
      text: string;
      externalized?: boolean;
      externalArtifact?: string | null;
      originalChars?: number;
    };
    expect(part.type).toBe("text");
    expect(part.externalized).toBe(true);
    expect(part.originalChars).toBe(50_000);
    expect(part.externalArtifact).toBeNull();
    // head 1024 + truncation note
    expect(part.text.startsWith("a".repeat(1024))).toBe(true);
    expect(part.text).toMatch(/externalized: 50000 chars/);
  });

  it("calls storage writer and uses uri in pointer", async () => {
    const original = bigText(30_000, "b");
    const msg = makeToolResultMessage([{ type: "text", text: original }]);
    const writer = vi.fn(async () => ({ uri: "artifact://abc" }));
    const r = await externalizeToolResultMessage(msg, {
      hardCapChars: 16_000,
      storageWriter: writer,
    });
    expect(writer).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({ byteLength: 30_000, ordinal: 0 }),
    );
    const part = (r.message as unknown as { content: unknown[] }).content[0] as {
      externalArtifact?: string | null;
      text: string;
    };
    expect(part.externalArtifact).toBe("artifact://abc");
    expect(part.text).toContain("artifact://abc");
  });

  it("does not re-process already externalized blocks", async () => {
    const msg = makeToolResultMessage([
      {
        type: "text",
        text: "head",
        externalized: true,
        externalArtifact: "artifact://x",
        originalChars: 99_999,
      },
    ]);
    const writer = vi.fn();
    const r = await externalizeToolResultMessage(msg, {
      hardCapChars: 1, // very small
      storageWriter: writer as never,
    });
    expect(writer).not.toHaveBeenCalled();
    expect(r.externalizedBlocks).toBe(0);
    expect(r.message).toBe(msg);
  });

  it("does not touch image / non-text blocks", async () => {
    const msg = makeToolResultMessage([
      { type: "image", source: { type: "base64", data: "deadbeef" } },
      { type: "text", text: bigText(20_000, "c") },
    ]);
    const r = await externalizeToolResultMessage(msg, { hardCapChars: 16_000 });
    const c0 = (r.message as unknown as { content: unknown[] }).content[0] as { type: string };
    const c1 = (r.message as unknown as { content: unknown[] }).content[1] as {
      externalized?: boolean;
    };
    expect(c0.type).toBe("image");
    expect(c1.externalized).toBe(true);
    expect(r.externalizedBlocks).toBe(1);
  });

  it("ignores non-toolResult messages", async () => {
    const msg = { role: "user", content: bigText(50_000, "d") } as unknown as AgentMessage;
    const r = await externalizeToolResultMessage(msg, { hardCapChars: 100 });
    expect(r.externalizedBlocks).toBe(0);
    expect(r.message).toBe(msg);
  });
});

describe("externalizeToolResultMessageSync", () => {
  it("uses sync storageRefBuilder for uri", () => {
    const original = bigText(20_000, "e");
    const msg = makeToolResultMessage([{ type: "text", text: original }]);
    const r = externalizeToolResultMessageSync(msg, {
      hardCapChars: 8_000,
      storageRefBuilder: ({ byteLength, ordinal }) => `mem://${ordinal}-${byteLength}`,
    });
    const part = (r.message as unknown as { content: unknown[] }).content[0] as {
      externalArtifact?: string | null;
    };
    expect(part.externalArtifact).toBe("mem://0-20000");
  });
});

describe("externalizeOversizedToolResults (batch)", () => {
  it("aggregates counters and preserves message order", async () => {
    const messages: AgentMessage[] = [
      makeToolResultMessage([{ type: "text", text: bigText(20_000, "f") }]),
      { role: "user", content: "hi" } as unknown as AgentMessage,
      makeToolResultMessage([
        { type: "text", text: "small" },
        { type: "text", text: bigText(40_000, "g") },
      ]),
    ];
    const r = await externalizeOversizedToolResults(messages, { hardCapChars: 16_000 });
    expect(r.messages).toHaveLength(3);
    expect(r.externalizedMessages).toBe(2);
    expect(r.externalizedBlocks).toBe(2);
    expect(r.externalizedChars).toBe(20_000 + 40_000);
    // 두 번째 메시지는 user 라 그대로
    expect(r.messages[1]).toBe(messages[1]);
  });
});
