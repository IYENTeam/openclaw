import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeAttemptResult, makeCompactionSuccess } from "./run.overflow-compaction.fixture.js";
import {
  loadRunOverflowCompactionHarness,
  mockedClearLiveModelSwitchPending,
  mockedCompactDirect,
  mockedLog,
  mockedResolveContextWindowInfo,
  mockedRunEmbeddedAttempt,
  mockedShouldSwitchToLiveModel,
  overflowBaseRunParams,
  resetRunOverflowCompactionHarnessMocks,
} from "./run.overflow-compaction.harness.js";

let runEmbeddedPiAgent: typeof import("./run.js").runEmbeddedPiAgent;

const TARGET_SELECTION = { provider: "openai-codex", model: "gpt-5.5" };

const cleanAttemptOverrides = {
  assistantTexts: [],
  toolMetas: [],
};

describe("live model switch pre-swap compaction", () => {
  beforeAll(async () => {
    ({ runEmbeddedPiAgent } = await loadRunOverflowCompactionHarness());
  });

  beforeEach(() => {
    resetRunOverflowCompactionHarnessMocks();
  });

  it("forces compaction with target model context when current prompt exceeds target ctx", async () => {
    // First attempt: clean (no tool/messaging activity) so canRestartForLiveSwitch is true,
    // with last-assistant prompt usage of 200k (current model still fits).
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        ...cleanAttemptOverrides,
        lastAssistant: {
          usage: { input: 200000 },
        } as never,
      }),
    );
    // Live switch surface returns a target model that is smaller than current.
    mockedShouldSwitchToLiveModel.mockReturnValueOnce(TARGET_SELECTION);
    // Resolver returns the small target ctx for the target model lookup.
    mockedResolveContextWindowInfo.mockImplementation((params: { modelId?: string } = {}) => {
      if (params.modelId === TARGET_SELECTION.model) {
        return { tokens: 128_000, source: "model" };
      }
      return { tokens: 200_000, source: "model" };
    });
    // Pre-swap compaction succeeds.
    mockedCompactDirect.mockResolvedValueOnce(
      makeCompactionSuccess({
        summary: "pre-swap compaction",
        tokensBefore: 200_000,
        tokensAfter: 90_000,
      }),
    );

    const err = await runEmbeddedPiAgent(overflowBaseRunParams).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("LiveSessionModelSwitchError");

    expect(mockedClearLiveModelSwitchPending).toHaveBeenCalledTimes(1);
    expect(mockedCompactDirect).toHaveBeenCalledTimes(1);
    expect(mockedCompactDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "test-session",
        sessionFile: "/tmp/session.json",
        tokenBudget: 128_000,
        force: true,
        compactionTarget: "budget",
        runtimeContext: expect.objectContaining({
          provider: TARGET_SELECTION.provider,
          model: TARGET_SELECTION.model,
          trigger: "live_switch_pre_swap",
        }),
      }),
    );
  });

  it("skips compaction when current prompt already fits in target ctx", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        ...cleanAttemptOverrides,
        lastAssistant: {
          usage: { input: 40_000 },
        } as never,
      }),
    );
    mockedShouldSwitchToLiveModel.mockReturnValueOnce(TARGET_SELECTION);
    mockedResolveContextWindowInfo.mockImplementation((params: { modelId?: string } = {}) => {
      if (params.modelId === TARGET_SELECTION.model) {
        return { tokens: 128_000, source: "model" };
      }
      return { tokens: 200_000, source: "model" };
    });

    const err = await runEmbeddedPiAgent(overflowBaseRunParams).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("LiveSessionModelSwitchError");

    expect(mockedClearLiveModelSwitchPending).toHaveBeenCalledTimes(1);
    expect(mockedCompactDirect).not.toHaveBeenCalled();
  });

  it("proceeds with swap when pre-swap compaction throws", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        ...cleanAttemptOverrides,
        lastAssistant: {
          usage: { input: 200_000 },
        } as never,
      }),
    );
    mockedShouldSwitchToLiveModel.mockReturnValueOnce(TARGET_SELECTION);
    mockedResolveContextWindowInfo.mockImplementation((params: { modelId?: string } = {}) => {
      if (params.modelId === TARGET_SELECTION.model) {
        return { tokens: 128_000, source: "model" };
      }
      return { tokens: 200_000, source: "model" };
    });
    const compactionError = new Error("simulated compaction failure");
    mockedCompactDirect.mockRejectedValueOnce(compactionError);

    const err = await runEmbeddedPiAgent(overflowBaseRunParams).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("LiveSessionModelSwitchError");

    expect(mockedCompactDirect).toHaveBeenCalledTimes(1);
    // The swap proceeds anyway — a warning is logged with the expected prefix.
    const warnedWithPreSwapPrefix = mockedLog.warn.mock.calls.some((call) => {
      const first = call[0];
      return (
        typeof first === "string" && first.startsWith("[live-switch] pre-swap compaction threw")
      );
    });
    expect(warnedWithPreSwapPrefix).toBe(true);
  });

  it("skips compaction when target ctx is unknown (defaults source)", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        ...cleanAttemptOverrides,
        lastAssistant: {
          usage: { input: 200_000 },
        } as never,
      }),
    );
    mockedShouldSwitchToLiveModel.mockReturnValueOnce(TARGET_SELECTION);
    mockedResolveContextWindowInfo.mockImplementation((params: { modelId?: string } = {}) => {
      if (params.modelId === TARGET_SELECTION.model) {
        return { tokens: 200_000, source: "default" };
      }
      return { tokens: 200_000, source: "model" };
    });

    const err = await runEmbeddedPiAgent(overflowBaseRunParams).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("LiveSessionModelSwitchError");

    // When target ctx falls back to "default", the precheck cannot be trusted to act,
    // so we skip compaction and rely on existing post-swap recovery paths.
    expect(mockedCompactDirect).not.toHaveBeenCalled();
  });
});
