import { describe, expect, test, vi } from "vitest";
import {
  decidePrReview,
  parsePrReviewDecisionText,
  resolvePrReviewDecision,
} from "./pr-review-decision.js";

function clawhipText(payload: Record<string, unknown>) {
  return `[clawhip:github.pr-review-submitted] review submitted\n\nPayload: ${JSON.stringify(
    payload,
    null,
    2,
  )}`;
}

function event(overrides: Record<string, unknown> = {}) {
  const parsed = parsePrReviewDecisionText(
    clawhipText({
      repository: { full_name: "openclaw/openclaw" },
      pull_request: {
        number: 42,
        title: "Automated PR",
        labels: [],
        state: "open",
        draft: false,
        user: { login: "contributor" },
      },
      review: { state: "COMMENTED", user: { login: "iyensystem[bot]" } },
      ...overrides,
    }),
  );
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.event;
}

describe("PR review decision helpers", () => {
  test("parses GitHub-style pr-review-submitted payload", () => {
    const parsed = parsePrReviewDecisionText(
      clawhipText({
        repository: { full_name: "openclaw/openclaw" },
        pull_request: {
          number: 7,
          title: "Add decision hook",
          labels: [{ name: "iyen:review" }],
          user: { login: "bot" },
          head: { sha: "abc123" },
        },
        review: {
          state: "changes_requested",
          body: "please fix",
          user: { login: "iyensystem[bot]" },
        },
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      event: expect.objectContaining({
        repo: "openclaw/openclaw",
        pullRequest: expect.objectContaining({ number: 7, title: "Add decision hook" }),
        review: expect.objectContaining({ state: "CHANGES_REQUESTED", author: "iyensystem[bot]" }),
      }),
    });
  });

  test("malformed payload is rejected", () => {
    expect(parsePrReviewDecisionText("no payload")).toEqual({
      ok: false,
      error: "Payload JSON required",
    });
  });

  test("disabled policy is safe noop", () => {
    expect(resolvePrReviewDecision(event(), { enabled: false })).toEqual({
      ok: true,
      status: "noop",
      decision: "noop",
      reason: "disabled",
    });
  });

  test("COMMENT review is observed without approval by default", () => {
    expect(resolvePrReviewDecision(event(), { enabled: true })).toEqual({
      ok: true,
      status: "noop",
      decision: "noop",
      reason: "comment",
    });
  });

  test("REQUEST_CHANGES waits by default and does not relabel", () => {
    expect(
      resolvePrReviewDecision(event({ review: { state: "REQUEST_CHANGES" } }), { enabled: true }),
    ).toEqual({
      ok: true,
      status: "wait",
      decision: "wait",
      reason: "changes-requested",
    });
  });

  test("REQUEST_CHANGES optional relabel is idempotent", async () => {
    const addLabels = vi.fn(async () => {});
    const result = await decidePrReview(
      event({ review: { state: "REQUEST_CHANGES" } }),
      { addLabels },
      { enabled: true, reReviewOnRequestChanges: true },
    );

    expect(result).toEqual({
      ok: true,
      status: "re-review",
      decision: "re-review",
      label: "iyen:review",
    });
    expect(addLabels).toHaveBeenCalledWith("openclaw/openclaw", 42, ["iyen:review"]);

    expect(
      await decidePrReview(
        event({
          pull_request: {
            number: 42,
            title: "Automated PR",
            labels: ["iyen:review"],
            state: "open",
          },
          review: { state: "REQUEST_CHANGES" },
        }),
        { addLabels },
        { enabled: true, reReviewOnRequestChanges: true },
      ),
    ).toEqual({ ok: true, status: "noop", decision: "noop", reason: "already-labeled" });
    expect(addLabels).toHaveBeenCalledTimes(1);
  });

  test("APPROVED is blocked by disabled approval lane", () => {
    expect(
      resolvePrReviewDecision(event({ review: { state: "APPROVED" } }), { enabled: true }),
    ).toEqual({
      ok: true,
      status: "noop",
      decision: "noop",
      reason: "approval-disabled",
    });
  });

  test("IYENsystem-authored PR cannot pass approval lane without human gate", () => {
    expect(
      resolvePrReviewDecision(
        event({
          pull_request: {
            number: 42,
            title: "Automated PR",
            labels: [],
            state: "open",
            user: { login: "iyensystem[bot]" },
          },
          review: { state: "APPROVED", user: { login: "iyensystem[bot]" } },
        }),
        {
          enabled: true,
          allowApproval: true,
          repoAllowlist: ["openclaw/openclaw"],
          requireHumanApproval: true,
          iyenReviewerLogins: ["iyensystem[bot]"],
          iyenAuthorLogins: ["iyensystem[bot]"],
        },
      ),
    ).toEqual({
      ok: true,
      status: "wait",
      decision: "wait",
      reason: "human-approval-required",
    });
  });
});
