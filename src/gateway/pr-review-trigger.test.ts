import { describe, expect, test, vi } from "vitest";
import {
  parsePrReviewTriggerText,
  resolvePrReviewTriggerDecision,
  triggerPrReview,
} from "./pr-review-trigger.js";

function clawhipText(payload: Record<string, unknown>) {
  return `[clawhip:github.pr-opened] PR event\n\nPayload: ${JSON.stringify(payload, null, 2)}`;
}

describe("PR review trigger helpers", () => {
  test("parses simplified clawhip PR payload", () => {
    const parsed = parsePrReviewTriggerText(
      clawhipText({
        repo: "openclaw/openclaw",
        number: 42,
        title: "Add hook",
        labels: [{ name: "safe" }, "area:gateway"],
        action: "opened",
        changed_files: 2,
        additions: 10,
        deletions: 1,
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      pullRequest: expect.objectContaining({
        repo: "openclaw/openclaw",
        number: 42,
        title: "Add hook",
        labels: ["safe", "area:gateway"],
        action: "opened",
        changed_files: 2,
        additions: 10,
        deletions: 1,
      }),
    });
  });

  test("parses GitHub-style pull_request payload", () => {
    const parsed = parsePrReviewTriggerText(
      clawhipText({
        action: "ready_for_review",
        repository: { full_name: "openclaw/openclaw" },
        pull_request: {
          number: 5,
          title: "Ready",
          draft: false,
          labels: [{ name: "ready" }],
          base: { ref: "main" },
          head: { ref: "feature" },
          user: { login: "contrib" },
        },
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      pullRequest: expect.objectContaining({
        repo: "openclaw/openclaw",
        number: 5,
        title: "Ready",
        action: "ready_for_review",
        base_ref: "main",
        head_ref: "feature",
        author: "contrib",
      }),
    });
  });

  test("rejects malformed payload", () => {
    expect(parsePrReviewTriggerText("no payload")).toEqual({
      ok: false,
      error: "Payload JSON required",
    });
  });

  test("policy is idempotent and skips closed or draft PRs by default", () => {
    expect(
      resolvePrReviewTriggerDecision({
        repo: "openclaw/openclaw",
        number: 1,
        title: "Already",
        labels: ["IYEN:REVIEW"],
      }),
    ).toEqual({ shouldLabel: false, reason: "already-labeled" });
    expect(
      resolvePrReviewTriggerDecision({
        repo: "openclaw/openclaw",
        number: 1,
        title: "Closed",
        labels: [],
        state: "closed",
      }),
    ).toEqual({ shouldLabel: false, reason: "closed" });
    expect(
      resolvePrReviewTriggerDecision({
        repo: "openclaw/openclaw",
        number: 1,
        title: "Draft",
        labels: [],
        draft: true,
      }),
    ).toEqual({ shouldLabel: false, reason: "draft" });
  });

  test("policy labels review-worthy open PRs", () => {
    expect(
      resolvePrReviewTriggerDecision(
        {
          repo: "openclaw/openclaw",
          number: 9,
          title: "Feature",
          labels: [],
          state: "open",
          action: "synchronize",
          changed_files: 1,
          additions: 1,
          deletions: 0,
        },
        { reviewLabel: "custom:review" },
      ),
    ).toEqual({ shouldLabel: true, label: "custom:review" });
  });

  test("trigger applies exactly one idempotent label action", async () => {
    const service = {
      addLabels: vi.fn(async () => {}),
    };

    const result = await triggerPrReview(
      {
        repo: "openclaw/openclaw",
        number: 11,
        title: "Review me",
        labels: [],
        state: "open",
      },
      service,
    );

    expect(result).toEqual({ ok: true, status: "labeled", label: "iyen:review" });
    expect(service.addLabels).toHaveBeenCalledTimes(1);
    expect(service.addLabels).toHaveBeenCalledWith("openclaw/openclaw", 11, ["iyen:review"]);
  });
});
