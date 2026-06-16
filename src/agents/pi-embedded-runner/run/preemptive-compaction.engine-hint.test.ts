// IYEN E-step: engine hint 가 preemptive compaction route 를 정상적으로 끌어올리는지 검증.

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, it, expect } from "vitest";
import { shouldPreemptivelyCompactBeforePrompt } from "./preemptive-compaction.js";

const tinyMessages: AgentMessage[] = [{ role: "user", content: "hi" } as unknown as AgentMessage];

function bigToolResultMessage(textChars: number): AgentMessage {
  return {
    role: "toolResult",
    content: [{ type: "text", text: "x".repeat(textChars) }],
  } as unknown as AgentMessage;
}

describe("shouldPreemptivelyCompactBeforePrompt — engine hint", () => {
  it("returns fits without hint when prompt fits", () => {
    const r = shouldPreemptivelyCompactBeforePrompt({
      messages: tinyMessages,
      systemPrompt: "you are helpful",
      prompt: "hello",
      contextTokenBudget: 200_000,
      reserveTokens: 1000,
    });
    expect(r.route).toBe("fits");
    expect(r.engineHintApplied).toBe(false);
  });

  it("escalates to compact_only when engine signals rotate even if no overflow", () => {
    const r = shouldPreemptivelyCompactBeforePrompt({
      messages: tinyMessages,
      prompt: "hi",
      contextTokenBudget: 200_000,
      reserveTokens: 1000,
      engineHint: { rotationLevel: "rotate", tokenRatio: 0.81 },
    });
    expect(r.route).toBe("compact_only");
    expect(r.shouldCompact).toBe(true);
    expect(r.engineHintApplied).toBe(true);
  });

  it("escalates to compact_only when engine signals block", () => {
    const r = shouldPreemptivelyCompactBeforePrompt({
      messages: tinyMessages,
      prompt: "hi",
      contextTokenBudget: 200_000,
      reserveTokens: 1000,
      engineHint: { rotationLevel: "block", tokenRatio: 0.95 },
    });
    expect(r.route).toBe("compact_only");
    expect(r.engineHintApplied).toBe(true);
  });

  it("upgrades fits to truncate_tool_results_only when hint=toolStoreThrottle and reducible chars exist", () => {
    const messagesWithBigResult: AgentMessage[] = [...tinyMessages, bigToolResultMessage(80_000)];
    const r = shouldPreemptivelyCompactBeforePrompt({
      messages: messagesWithBigResult,
      prompt: "hi",
      contextTokenBudget: 200_000,
      reserveTokens: 1000,
      engineHint: { rotationLevel: "toolStoreThrottle", tokenRatio: 0.72 },
    });
    expect(r.route).toBe("truncate_tool_results_only");
    expect(r.engineHintApplied).toBe(true);
  });

  it("does NOT downgrade compact_only to truncate_tool_results_only via hint", () => {
    // 강제로 큰 prompt 만들기: enormous tool result + tiny budget
    const huge: AgentMessage[] = [bigToolResultMessage(80_000)];
    const baseline = shouldPreemptivelyCompactBeforePrompt({
      messages: huge,
      prompt: "x".repeat(40_000),
      contextTokenBudget: 16_000, // 매우 작음 → overflow
      reserveTokens: 1000,
    });
    expect(["compact_only", "compact_then_truncate"]).toContain(baseline.route);

    // toolStoreThrottle hint 가 들어와도 그대로 유지
    const withHint = shouldPreemptivelyCompactBeforePrompt({
      messages: huge,
      prompt: "x".repeat(40_000),
      contextTokenBudget: 16_000,
      reserveTokens: 1000,
      engineHint: { rotationLevel: "toolStoreThrottle" },
    });
    expect(withHint.route).toBe(baseline.route);
    expect(withHint.engineHintApplied).toBe(false);
  });

  it("ok / summarize hints leave route unchanged", () => {
    const r1 = shouldPreemptivelyCompactBeforePrompt({
      messages: tinyMessages,
      prompt: "hi",
      contextTokenBudget: 200_000,
      reserveTokens: 1000,
      engineHint: { rotationLevel: "ok" },
    });
    expect(r1.route).toBe("fits");
    expect(r1.engineHintApplied).toBe(false);
    const r2 = shouldPreemptivelyCompactBeforePrompt({
      messages: tinyMessages,
      prompt: "hi",
      contextTokenBudget: 200_000,
      reserveTokens: 1000,
      engineHint: { rotationLevel: "summarize" },
    });
    expect(r2.route).toBe("fits");
    expect(r2.engineHintApplied).toBe(false);
  });
});
