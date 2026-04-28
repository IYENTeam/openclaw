export type IyenSystemPrReviewTriggerConfig = {
  /** Enable the dedicated `/hooks/pr-review-trigger` GitHub PR review label handler. Default: false. */
  enabled?: boolean;
  /** Environment variable containing the GitHub PAT/installation token. Default: OPENCLAW_IYENSYSTEM_GITHUB_TOKEN, then GITHUB_TOKEN. */
  githubTokenEnv?: string;
  /** Label applied to PRs that should enter IYENsystem review. Default: iyen:review. */
  reviewLabel?: string;
  /** Include draft PRs. Default: false. */
  includeDrafts?: boolean;
  /** Minimum changed files required when the payload includes changed_files. Default: 1. */
  minChangedFiles?: number;
  /** Minimum additions + deletions required when the payload includes additions/deletions. Default: 1. */
  minTotalChanges?: number;
};

export type IyenSystemConfig = {
  /** Master opt-in for OpenClaw ↔ IYENsystem integrations. Default: false. */
  enabled?: boolean;
  prReviewTrigger?: IyenSystemPrReviewTriggerConfig;
};
