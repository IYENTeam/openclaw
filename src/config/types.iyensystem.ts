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

export type IyenSystemPrReviewDecisionConfig = {
  /** Enable the dedicated `/hooks/pr-review-decision` PR review submitted handler. Default: false. */
  enabled?: boolean;
  /** Environment variable containing the GitHub PAT/installation token. Default: OPENCLAW_IYENSYSTEM_GITHUB_TOKEN, then GITHUB_TOKEN. */
  githubTokenEnv?: string;
  /** Label re-applied when requesting another IYENsystem review pass. Default: iyen:review. */
  reviewLabel?: string;
  /** Re-apply the review label on CHANGES_REQUESTED. Default: false. */
  reReviewOnRequestChanges?: boolean;
  /** Allow the approval decision lane. Live approval submission is still not implemented. Default: false. */
  allowApproval?: boolean;
  /** Require a human approval when the reviewer or PR author is an IYENsystem actor. Default: true. */
  requireHumanApproval?: boolean;
  /** Repositories eligible for the approval decision lane. Empty by default. */
  repoAllowlist?: string[];
  /** Reviewer logins treated as IYENsystem/non-human. Empty by default. */
  iyenReviewerLogins?: string[];
  /** PR author logins treated as IYENsystem/non-human. Empty by default. */
  iyenAuthorLogins?: string[];
};

export type IyenSystemConfig = {
  /** Master opt-in for OpenClaw ↔ IYENsystem integrations. Default: false. */
  enabled?: boolean;
  prReviewTrigger?: IyenSystemPrReviewTriggerConfig;
  prReviewDecision?: IyenSystemPrReviewDecisionConfig;
};
