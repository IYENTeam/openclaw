export const PR_REVIEW_DECISION_DEFAULT_LABEL = "iyen:review";

export type PrReviewDecisionReviewState = "COMMENTED" | "CHANGES_REQUESTED" | "APPROVED";

export type PrReviewDecisionPullRequest = {
  repo: string;
  number: number;
  title: string;
  html_url?: string;
  labels: string[];
  state?: string;
  draft?: boolean;
  merged?: boolean;
  author?: string;
  head_sha?: string;
};

export type PrReviewDecisionReview = {
  state: PrReviewDecisionReviewState;
  author?: string;
  body?: string;
  html_url?: string;
  submitted_at?: string;
};

export type PrReviewDecisionEvent = {
  repo: string;
  pullRequest: PrReviewDecisionPullRequest;
  review: PrReviewDecisionReview;
};

export type PrReviewDecisionPolicy = {
  enabled?: boolean;
  reviewLabel?: string;
  reReviewOnRequestChanges?: boolean;
  allowApproval?: boolean;
  requireHumanApproval?: boolean;
  repoAllowlist?: string[];
  iyenReviewerLogins?: string[];
  iyenAuthorLogins?: string[];
};

export type PrReviewDecisionService = {
  getPullRequest?: (repo: string, pullNumber: number) => Promise<PrReviewDecisionPullRequest>;
  addLabels?: (repo: string, pullNumber: number, labels: string[]) => Promise<void>;
};

export type PrReviewDecisionResult =
  | {
      ok: true;
      status: "noop";
      decision: "noop";
      reason:
        | "disabled"
        | "comment"
        | "already-labeled"
        | "closed"
        | "draft"
        | "approval-disabled"
        | "approval-service-not-implemented";
    }
  | {
      ok: true;
      status: "wait";
      decision: "wait";
      reason: "changes-requested" | "human-approval-required" | "repo-not-allowlisted";
    }
  | { ok: true; status: "re-review"; decision: "re-review"; label: string }
  | { ok: false; httpStatus: 400 | 502 | 503; error: string };

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const labels: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const label = entry.trim();
      if (label) {
        labels.push(label);
      }
      continue;
    }
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as { name?: unknown }).name === "string"
    ) {
      const label = (entry as { name: string }).name.trim();
      if (label) {
        labels.push(label);
      }
    }
  }
  return labels;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeReviewState(value: unknown): PrReviewDecisionReviewState | undefined {
  const state = normalizeString(value)?.toUpperCase();
  if (state === "COMMENTED" || state === "COMMENT") {
    return "COMMENTED";
  }
  if (state === "CHANGES_REQUESTED" || state === "REQUEST_CHANGES") {
    return "CHANGES_REQUESTED";
  }
  if (state === "APPROVED" || state === "APPROVE") {
    return "APPROVED";
  }
  return undefined;
}

function extractRepo(payload: Record<string, unknown>): string | undefined {
  const direct = normalizeString(payload.repo);
  if (direct) {
    return direct;
  }
  return normalizeString(asRecord(payload.repository).full_name);
}

export function extractPrReviewDecisionPayloadJson(text: string): string | undefined {
  const marker = "Payload:";
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex < 0) {
    return undefined;
  }
  const afterMarker = text.slice(markerIndex + marker.length).trim();
  if (!afterMarker.startsWith("{")) {
    return undefined;
  }
  return afterMarker;
}

export function parsePrReviewDecisionText(
  text: unknown,
): { ok: true; event: PrReviewDecisionEvent } | { ok: false; error: string } {
  const normalizedText = normalizeString(text);
  if (!normalizedText) {
    return { ok: false, error: "text required" };
  }
  const jsonText = extractPrReviewDecisionPayloadJson(normalizedText);
  if (!jsonText) {
    return { ok: false, error: "Payload JSON required" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "Payload JSON is invalid" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Payload JSON must be an object" };
  }

  const payload = parsed as Record<string, unknown>;
  const repo = extractRepo(payload);
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return { ok: false, error: "Payload repo must be owner/name" };
  }

  const pr = asRecord(payload.pull_request ?? payload.pr);
  const number = payload.number ?? pr.number;
  if (!Number.isInteger(number) || (number as number) <= 0) {
    return { ok: false, error: "Payload number must be a positive integer" };
  }
  const title = normalizeString(payload.title) ?? normalizeString(pr.title);
  if (!title) {
    return { ok: false, error: "Payload title required" };
  }

  const review = asRecord(payload.review);
  const state = normalizeReviewState(payload.state ?? review.state);
  if (!state) {
    return {
      ok: false,
      error: "Payload review state must be COMMENTED, CHANGES_REQUESTED, or APPROVED",
    };
  }

  return {
    ok: true,
    event: {
      repo,
      pullRequest: {
        repo,
        number: number as number,
        title,
        html_url: normalizeString(payload.html_url) ?? normalizeString(pr.html_url),
        labels: normalizeLabels(payload.labels ?? pr.labels),
        state: (normalizeString(payload.pull_state) ?? normalizeString(pr.state))?.toLowerCase(),
        draft: normalizeBoolean(payload.draft) ?? normalizeBoolean(pr.draft),
        merged: normalizeBoolean(payload.merged) ?? normalizeBoolean(pr.merged),
        author: normalizeString(payload.author) ?? normalizeString(asRecord(pr.user).login),
        head_sha:
          normalizeString(payload.head_sha) ??
          normalizeString(asRecord(pr.head).sha) ??
          normalizeString(pr.head_sha),
      },
      review: {
        state,
        author:
          normalizeString(payload.reviewer) ??
          normalizeString(payload.review_author) ??
          normalizeString(asRecord(review.user).login),
        body: normalizeString(payload.body) ?? normalizeString(review.body),
        html_url: normalizeString(review.html_url),
        submitted_at: normalizeString(review.submitted_at),
      },
    },
  };
}

function normalizedSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function isRepoAllowlisted(repo: string, allowlist: string[] | undefined): boolean {
  const entries = normalizedSet(allowlist);
  return entries.has(repo.toLowerCase());
}

function isIyenActor(login: string | undefined, logins: string[] | undefined): boolean {
  if (!login) {
    return false;
  }
  return normalizedSet(logins).has(login.toLowerCase());
}

export function resolvePrReviewDecision(
  event: PrReviewDecisionEvent,
  policy: PrReviewDecisionPolicy = {},
): PrReviewDecisionResult {
  if (policy.enabled !== true) {
    return { ok: true, status: "noop", decision: "noop", reason: "disabled" };
  }

  const pullRequest = event.pullRequest;
  if (pullRequest.state?.toLowerCase() === "closed" || pullRequest.merged === true) {
    return { ok: true, status: "noop", decision: "noop", reason: "closed" };
  }
  if (pullRequest.draft === true) {
    return { ok: true, status: "noop", decision: "noop", reason: "draft" };
  }

  if (event.review.state === "COMMENTED") {
    return { ok: true, status: "noop", decision: "noop", reason: "comment" };
  }

  if (event.review.state === "CHANGES_REQUESTED") {
    if (policy.reReviewOnRequestChanges !== true) {
      return { ok: true, status: "wait", decision: "wait", reason: "changes-requested" };
    }
    const label = policy.reviewLabel?.trim() || PR_REVIEW_DECISION_DEFAULT_LABEL;
    const labelSet = new Set(pullRequest.labels.map((entry) => entry.toLowerCase()));
    if (labelSet.has(label.toLowerCase())) {
      return { ok: true, status: "noop", decision: "noop", reason: "already-labeled" };
    }
    return { ok: true, status: "re-review", decision: "re-review", label };
  }

  if (policy.allowApproval !== true) {
    return { ok: true, status: "noop", decision: "noop", reason: "approval-disabled" };
  }
  if (!isRepoAllowlisted(event.repo, policy.repoAllowlist)) {
    return { ok: true, status: "wait", decision: "wait", reason: "repo-not-allowlisted" };
  }
  const requireHumanApproval = policy.requireHumanApproval !== false;
  if (
    requireHumanApproval &&
    (isIyenActor(event.review.author, policy.iyenReviewerLogins) ||
      isIyenActor(pullRequest.author, policy.iyenAuthorLogins))
  ) {
    return { ok: true, status: "wait", decision: "wait", reason: "human-approval-required" };
  }
  return {
    ok: true,
    status: "noop",
    decision: "noop",
    reason: "approval-service-not-implemented",
  };
}

export async function decidePrReview(
  inputEvent: PrReviewDecisionEvent,
  service: PrReviewDecisionService | undefined,
  policy: PrReviewDecisionPolicy = {},
): Promise<PrReviewDecisionResult> {
  let event = inputEvent;
  if (service?.getPullRequest) {
    try {
      event = {
        ...inputEvent,
        pullRequest: await service.getPullRequest(inputEvent.repo, inputEvent.pullRequest.number),
      };
    } catch {
      return { ok: false, httpStatus: 502, error: "GitHub pull request API failed" };
    }
  }

  const decision = resolvePrReviewDecision(event, policy);
  if (!decision.ok || decision.status !== "re-review") {
    return decision;
  }
  if (!service?.addLabels) {
    return { ok: false, httpStatus: 503, error: "PR review decision service is not configured" };
  }
  try {
    await service.addLabels(event.repo, event.pullRequest.number, [decision.label]);
  } catch {
    return { ok: false, httpStatus: 502, error: "GitHub label API failed" };
  }
  return decision;
}
