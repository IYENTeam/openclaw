import { describe, expect, test } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("IYENsystem config schema", () => {
  test("accepts disabled safe-default config", () => {
    const result = OpenClawSchema.parse({
      iyensystem: {
        enabled: false,
        prReviewTrigger: { enabled: false },
        prReviewDecision: { enabled: false },
      },
    });

    expect(result.iyensystem?.enabled).toBe(false);
    expect(result.iyensystem?.prReviewTrigger?.enabled).toBe(false);
    expect(result.iyensystem?.prReviewDecision?.enabled).toBe(false);
  });

  test("accepts explicit PR review trigger policy", () => {
    const result = OpenClawSchema.parse({
      iyensystem: {
        enabled: true,
        prReviewTrigger: {
          enabled: true,
          githubTokenEnv: "OPENCLAW_IYENSYSTEM_GITHUB_TOKEN",
          reviewLabel: "iyen:review",
          includeDrafts: false,
          minChangedFiles: 1,
          minTotalChanges: 1,
        },
      },
    });

    expect(result.iyensystem?.prReviewTrigger?.reviewLabel).toBe("iyen:review");
  });

  test("accepts explicit safe PR review decision policy", () => {
    const result = OpenClawSchema.parse({
      iyensystem: {
        enabled: true,
        prReviewDecision: {
          enabled: true,
          githubTokenEnv: "OPENCLAW_IYENSYSTEM_GITHUB_TOKEN",
          reviewLabel: "iyen:review",
          reReviewOnRequestChanges: false,
          allowApproval: false,
          requireHumanApproval: true,
          repoAllowlist: ["openclaw/openclaw"],
          iyenReviewerLogins: ["iyensystem[bot]"],
          iyenAuthorLogins: ["iyensystem[bot]"],
        },
      },
    });

    expect(result.iyensystem?.prReviewDecision?.allowApproval).toBe(false);
  });
});
