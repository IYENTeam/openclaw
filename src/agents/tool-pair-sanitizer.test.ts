import { describe, expect, it } from "vitest";
import { sanitizeMessagesForToolPairs } from "./tool-pair-sanitizer.js";

describe("sanitizeMessagesForToolPairs", () => {
  it("returns the input unchanged when every tool_call has a matching tool_result", () => {
    const messages = [
      { role: "user", content: "do x" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "tool_use", id: "call_1", name: "search", input: {} },
        ],
      },
      {
        role: "tool_result",
        toolCallId: "call_1",
        content: [{ type: "tool_result", tool_use_id: "call_1", text: "result" }],
      },
    ];
    const result = sanitizeMessagesForToolPairs(messages);
    expect(result.sanitized).toBe(false);
    expect(result.messages).toBe(messages);
    expect(result.removedCallIds).toEqual([]);
    expect(result.removedResultMessages).toBe(0);
  });

  it("strips orphan tool_use parts from assistant messages but keeps text", () => {
    const messages = [
      { role: "user", content: "do x" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "thinking" },
          { type: "tool_use", id: "call_1", name: "search", input: {} },
        ],
      },
    ];
    const result = sanitizeMessagesForToolPairs(messages);
    expect(result.sanitized).toBe(true);
    expect(result.removedCallIds).toEqual(["call_1"]);
    expect(result.removedResultMessages).toBe(0);
    expect(result.messages).toHaveLength(2);
    const assistantMessage = result.messages[1] as { content: unknown[] };
    expect(assistantMessage.content).toEqual([{ type: "text", text: "thinking" }]);
  });

  it("drops the entire assistant message when every part is an orphan tool_use", () => {
    const messages = [
      { role: "user", content: "do x" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "call_1", name: "search", input: {} },
          { type: "tool_use", id: "call_2", name: "fetch", input: {} },
        ],
      },
    ];
    const result = sanitizeMessagesForToolPairs(messages);
    expect(result.sanitized).toBe(true);
    expect(new Set(result.removedCallIds)).toEqual(new Set(["call_1", "call_2"]));
    expect(result.messages).toHaveLength(1);
    expect((result.messages[0] as { role: string }).role).toBe("user");
  });

  it("drops orphan tool_result messages whose toolCallId has no matching tool_use", () => {
    const messages = [
      { role: "user", content: "do x" },
      {
        role: "tool_result",
        toolCallId: "ghost_id",
        content: [{ type: "tool_result", tool_use_id: "ghost_id", text: "stale" }],
      },
      { role: "user", content: "again" },
    ];
    const result = sanitizeMessagesForToolPairs(messages);
    expect(result.sanitized).toBe(true);
    expect(result.removedCallIds).toEqual([]);
    expect(result.removedResultMessages).toBe(1);
    expect(result.messages).toHaveLength(2);
    expect((result.messages[0] as { role: string }).role).toBe("user");
    expect((result.messages[1] as { role: string }).role).toBe("user");
  });

  it("handles a mix of orphan tool_use and orphan tool_result independently", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "before" },
          { type: "tool_use", id: "call_a", name: "x", input: {} },
        ],
      },
      {
        role: "tool_result",
        toolCallId: "ghost_b",
        content: [{ type: "tool_result", tool_use_id: "ghost_b", text: "stale" }],
      },
    ];
    const result = sanitizeMessagesForToolPairs(messages);
    expect(result.sanitized).toBe(true);
    expect(result.removedCallIds).toEqual(["call_a"]);
    expect(result.removedResultMessages).toBe(1);
    expect(result.messages).toHaveLength(1);
    const remaining = result.messages[0] as { role: string; content: unknown[] };
    expect(remaining.role).toBe("assistant");
    expect(remaining.content).toEqual([{ type: "text", text: "before" }]);
  });

  it("normalizes call ids that contain pipe-suffixed segments", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_42|seg1" }],
      },
      {
        role: "tool_result",
        toolCallId: "call_42|seg2",
        content: [{ type: "tool_result", tool_use_id: "call_42|seg3", text: "ok" }],
      },
    ];
    const result = sanitizeMessagesForToolPairs(messages);
    expect(result.sanitized).toBe(false);
    expect(result.removedCallIds).toEqual([]);
    expect(result.removedResultMessages).toBe(0);
  });

  it("recognizes legacy function_call / function_call_output pairs", () => {
    const matched = [
      {
        role: "assistant",
        content: [{ type: "function_call", id: "fn_1", name: "do", arguments: "{}" }],
      },
      {
        role: "tool",
        content: [{ type: "function_call_output", call_id: "fn_1", output: "ok" }],
      },
    ];
    expect(sanitizeMessagesForToolPairs(matched).sanitized).toBe(false);

    const orphan = [
      {
        role: "assistant",
        content: [{ type: "function_call", id: "fn_2", name: "do", arguments: "{}" }],
      },
    ];
    const result = sanitizeMessagesForToolPairs(orphan);
    expect(result.sanitized).toBe(true);
    expect(result.removedCallIds).toEqual(["fn_2"]);
  });

  it("does not mutate the input array", () => {
    const original = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "x" },
          { type: "tool_use", id: "orphan", name: "n", input: {} },
        ],
      },
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    sanitizeMessagesForToolPairs(original);
    expect(original).toEqual(snapshot);
  });

  it("tolerates malformed messages without throwing and treats id-less tool_result as orphan", () => {
    const messages = [
      null,
      undefined,
      "not-a-message",
      { role: "assistant", content: null },
      { role: "tool_result" },
    ] as unknown[];
    const result = sanitizeMessagesForToolPairs(messages as never);
    expect(result.sanitized).toBe(true);
    expect(result.removedResultMessages).toBe(1);
    expect(result.messages.length).toBe(messages.length - 1);
    expect(
      result.messages.map((m) =>
        typeof m === "object" && m !== null ? (m as { role?: string }).role : m,
      ),
    ).not.toContain("tool_result");
  });
});
