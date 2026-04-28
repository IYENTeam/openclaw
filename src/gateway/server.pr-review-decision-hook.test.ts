import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createHookRequest,
  createHooksHandler,
  createResponse,
} from "./server-http.test-harness.js";

const { readJsonBodyMock } = vi.hoisted(() => ({
  readJsonBodyMock: vi.fn(),
}));

vi.mock("./hooks.js", async () => {
  const actual = await vi.importActual<typeof import("./hooks.js")>("./hooks.js");
  return {
    ...actual,
    readJsonBody: readJsonBodyMock,
  };
});

function payload(overrides: Record<string, unknown> = {}) {
  return {
    text: `[clawhip:github.pr-review-submitted] review submitted\n\nPayload: ${JSON.stringify({
      repository: { full_name: "openclaw/openclaw" },
      pull_request: {
        number: 17,
        title: "Add decision hook",
        labels: [],
        state: "open",
        draft: false,
        user: { login: "contributor" },
      },
      review: { state: "COMMENTED", user: { login: "iyensystem[bot]" } },
      ...overrides,
    })}`,
    mode: "now",
  };
}

describe("PR review decision hook endpoint", () => {
  beforeEach(() => {
    readJsonBodyMock.mockReset();
  });

  test("POST /hooks/pr-review-decision handles COMMENT as safe noop", async () => {
    readJsonBodyMock.mockResolvedValue({ ok: true, value: payload() });
    const handler = createHooksHandler({ prReviewDecisionPolicy: { enabled: true } });
    const { res, getBody } = createResponse();

    const handled = await handler(createHookRequest({ url: "/hooks/pr-review-decision" }), res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({
      ok: true,
      status: "noop",
      decision: "noop",
      reason: "comment",
    });
  });

  test("disabled policy returns safe noop without requiring service", async () => {
    readJsonBodyMock.mockResolvedValue({ ok: true, value: payload() });
    const handler = createHooksHandler({ prReviewDecisionPolicy: { enabled: false } });
    const { res, getBody } = createResponse();

    const handled = await handler(createHookRequest({ url: "/hooks/pr-review-decision" }), res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({
      ok: true,
      status: "noop",
      decision: "noop",
      reason: "disabled",
    });
  });

  test("REQUEST_CHANGES waits by default", async () => {
    readJsonBodyMock.mockResolvedValue({
      ok: true,
      value: payload({ review: { state: "REQUEST_CHANGES" } }),
    });
    const handler = createHooksHandler({ prReviewDecisionPolicy: { enabled: true } });
    const { res, getBody } = createResponse();

    const handled = await handler(createHookRequest({ url: "/hooks/pr-review-decision" }), res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({
      ok: true,
      status: "wait",
      decision: "wait",
      reason: "changes-requested",
    });
  });

  test("APPROVED by IYENsystem actor is blocked by human gate", async () => {
    readJsonBodyMock.mockResolvedValue({
      ok: true,
      value: payload({
        pull_request: {
          number: 17,
          title: "Add decision hook",
          labels: [],
          state: "open",
          user: { login: "iyensystem[bot]" },
        },
        review: { state: "APPROVED", user: { login: "iyensystem[bot]" } },
      }),
    });
    const handler = createHooksHandler({
      prReviewDecisionPolicy: {
        enabled: true,
        allowApproval: true,
        repoAllowlist: ["openclaw/openclaw"],
        requireHumanApproval: true,
        iyenReviewerLogins: ["iyensystem[bot]"],
        iyenAuthorLogins: ["iyensystem[bot]"],
      },
    });
    const { res, getBody } = createResponse();

    const handled = await handler(createHookRequest({ url: "/hooks/pr-review-decision" }), res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({
      ok: true,
      status: "wait",
      decision: "wait",
      reason: "human-approval-required",
    });
  });

  test("maps malformed clawhip payload to 400", async () => {
    readJsonBodyMock.mockResolvedValue({ ok: true, value: { text: "no payload", mode: "now" } });
    const handler = createHooksHandler({ prReviewDecisionPolicy: { enabled: true } });
    const { res, getBody } = createResponse();

    const handled = await handler(createHookRequest({ url: "/hooks/pr-review-decision" }), res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(getBody())).toEqual({ ok: false, error: "Payload JSON required" });
  });
});
