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
    text: `[clawhip:github.pr-opened] opened\n\nPayload: ${JSON.stringify({
      repo: "openclaw/openclaw",
      number: 17,
      title: "Add review trigger",
      labels: [],
      action: "opened",
      changed_files: 2,
      additions: 8,
      deletions: 1,
      ...overrides,
    })}`,
    mode: "now",
  };
}

describe("PR review trigger hook endpoint", () => {
  beforeEach(() => {
    readJsonBodyMock.mockReset();
  });

  test("POST /hooks/pr-review-trigger applies review label and returns result", async () => {
    readJsonBodyMock.mockResolvedValue({ ok: true, value: payload() });
    const prReviewTriggerService = {
      addLabels: vi.fn(async () => {}),
    };
    const handler = createHooksHandler({ prReviewTriggerService });
    const { res, getBody } = createResponse();

    const handled = await handler(createHookRequest({ url: "/hooks/pr-review-trigger" }), res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({ ok: true, status: "labeled", label: "iyen:review" });
    expect(prReviewTriggerService.addLabels).toHaveBeenCalledWith("openclaw/openclaw", 17, [
      "iyen:review",
    ]);
  });

  test("returns noop for already-labeled PR without duplicate label action", async () => {
    readJsonBodyMock.mockResolvedValue({ ok: true, value: payload({ labels: ["iyen:review"] }) });
    const prReviewTriggerService = {
      addLabels: vi.fn(async () => {}),
    };
    const handler = createHooksHandler({ prReviewTriggerService });
    const { res, getBody } = createResponse();

    const handled = await handler(createHookRequest({ url: "/hooks/pr-review-trigger" }), res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({ ok: true, status: "noop", reason: "already-labeled" });
    expect(prReviewTriggerService.addLabels).not.toHaveBeenCalled();
  });

  test("returns 503 when PR review trigger service is not configured", async () => {
    readJsonBodyMock.mockResolvedValue({ ok: true, value: payload() });
    const handler = createHooksHandler({});
    const { res, getBody } = createResponse();

    const handled = await handler(createHookRequest({ url: "/hooks/pr-review-trigger" }), res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(getBody())).toEqual({
      ok: false,
      error: "PR review trigger service is not configured",
    });
  });

  test("maps malformed clawhip payload to 400", async () => {
    readJsonBodyMock.mockResolvedValue({ ok: true, value: { text: "no payload", mode: "now" } });
    const handler = createHooksHandler({
      prReviewTriggerService: {
        addLabels: vi.fn(async () => {}),
      },
    });
    const { res, getBody } = createResponse();

    const handled = await handler(createHookRequest({ url: "/hooks/pr-review-trigger" }), res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(getBody())).toEqual({ ok: false, error: "Payload JSON required" });
  });
});
