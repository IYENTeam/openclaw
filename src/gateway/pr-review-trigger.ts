export const PR_REVIEW_TRIGGER_DEFAULT_LABEL = "iyen:review";

export type PrReviewTriggerPullRequest = {
  repo: string;
  number: number;
  title: string;
  html_url?: string;
  labels: string[];
  state?: string;
  draft?: boolean;
  merged?: boolean;
  action?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  base_ref?: string;
  head_ref?: string;
  author?: string;
};

export type PrReviewTriggerPolicy = {
  reviewLabel?: string;
  includeDrafts?: boolean;
  minChangedFiles?: number;
  minTotalChanges?: number;
};

export type PrReviewTriggerService = {
  getPullRequest?: (repo: string, pullNumber: number) => Promise<PrReviewTriggerPullRequest>;
  addLabels: (repo: string, pullNumber: number, labels: string[]) => Promise<void>;
};

export type PrReviewTriggerNoopReason =
  | "already-labeled"
  | "closed"
  | "draft"
  | "not-review-worthy";

export type PrReviewTriggerResult =
  | { ok: true; status: "noop"; reason: PrReviewTriggerNoopReason }
  | { ok: true; status: "labeled"; label: string }
  | { ok: false; httpStatus: 400 | 502; error: string };

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

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
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

function extractRepo(payload: Record<string, unknown>): string | undefined {
  const direct = normalizeString(payload.repo);
  if (direct) {
    return direct;
  }
  const repository = payload.repository;
  if (repository && typeof repository === "object") {
    return normalizeString((repository as { full_name?: unknown }).full_name);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function extractPrReviewPayloadJson(text: string): string | undefined {
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

export function parsePrReviewTriggerText(
  text: unknown,
): { ok: true; pullRequest: PrReviewTriggerPullRequest } | { ok: false; error: string } {
  const normalizedText = normalizeString(text);
  if (!normalizedText) {
    return { ok: false, error: "text required" };
  }
  const jsonText = extractPrReviewPayloadJson(normalizedText);
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
  const pr = asRecord(payload.pull_request ?? payload.pr);
  const repo = extractRepo(payload);
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return { ok: false, error: "Payload repo must be owner/name" };
  }
  const number = payload.number ?? pr.number;
  if (!Number.isInteger(number) || (number as number) <= 0) {
    return { ok: false, error: "Payload number must be a positive integer" };
  }
  const title = normalizeString(payload.title) ?? normalizeString(pr.title);
  if (!title) {
    return { ok: false, error: "Payload title required" };
  }

  return {
    ok: true,
    pullRequest: {
      repo,
      number: number as number,
      title,
      html_url: normalizeString(payload.html_url) ?? normalizeString(pr.html_url),
      labels: normalizeLabels(payload.labels ?? pr.labels),
      state: (normalizeString(payload.state) ?? normalizeString(pr.state))?.toLowerCase(),
      draft: normalizeBoolean(payload.draft) ?? normalizeBoolean(pr.draft),
      merged: normalizeBoolean(payload.merged) ?? normalizeBoolean(pr.merged),
      action: normalizeString(payload.action)?.toLowerCase(),
      additions: normalizeNonNegativeInteger(payload.additions ?? pr.additions),
      deletions: normalizeNonNegativeInteger(payload.deletions ?? pr.deletions),
      changed_files: normalizeNonNegativeInteger(payload.changed_files ?? pr.changed_files),
      base_ref: normalizeString(payload.base_ref) ?? normalizeString(asRecord(pr.base).ref),
      head_ref: normalizeString(payload.head_ref) ?? normalizeString(asRecord(pr.head).ref),
      author: normalizeString(payload.author) ?? normalizeString(asRecord(pr.user).login),
    },
  };
}

export function resolvePrReviewTriggerDecision(
  pullRequest: PrReviewTriggerPullRequest,
  policy: PrReviewTriggerPolicy = {},
):
  | { shouldLabel: true; label: string }
  | { shouldLabel: false; reason: PrReviewTriggerNoopReason } {
  const label = policy.reviewLabel?.trim() || PR_REVIEW_TRIGGER_DEFAULT_LABEL;
  const labelSet = new Set(pullRequest.labels.map((entry) => entry.toLowerCase()));
  if (labelSet.has(label.toLowerCase())) {
    return { shouldLabel: false, reason: "already-labeled" };
  }
  if (pullRequest.state?.toLowerCase() === "closed" || pullRequest.merged === true) {
    return { shouldLabel: false, reason: "closed" };
  }
  if (pullRequest.draft === true && policy.includeDrafts !== true) {
    return { shouldLabel: false, reason: "draft" };
  }
  const action = pullRequest.action?.toLowerCase();
  if (
    action &&
    !new Set(["opened", "reopened", "synchronize", "ready_for_review", "edited"]).has(action)
  ) {
    return { shouldLabel: false, reason: "not-review-worthy" };
  }
  const minChangedFiles = policy.minChangedFiles ?? 1;
  if (pullRequest.changed_files !== undefined && pullRequest.changed_files < minChangedFiles) {
    return { shouldLabel: false, reason: "not-review-worthy" };
  }
  const minTotalChanges = policy.minTotalChanges ?? 1;
  const additions = pullRequest.additions;
  const deletions = pullRequest.deletions;
  if (
    additions !== undefined &&
    deletions !== undefined &&
    additions + deletions < minTotalChanges
  ) {
    return { shouldLabel: false, reason: "not-review-worthy" };
  }
  return { shouldLabel: true, label };
}

export async function triggerPrReview(
  inputPullRequest: PrReviewTriggerPullRequest,
  service: PrReviewTriggerService,
  policy: PrReviewTriggerPolicy = {},
): Promise<PrReviewTriggerResult> {
  let pullRequest = inputPullRequest;
  if (service.getPullRequest) {
    try {
      pullRequest = await service.getPullRequest(inputPullRequest.repo, inputPullRequest.number);
    } catch {
      return { ok: false, httpStatus: 502, error: "GitHub pull request API failed" };
    }
  }

  const decision = resolvePrReviewTriggerDecision(pullRequest, policy);
  if (!decision.shouldLabel) {
    return { ok: true, status: "noop", reason: decision.reason };
  }

  try {
    await service.addLabels(pullRequest.repo, pullRequest.number, [decision.label]);
  } catch {
    return { ok: false, httpStatus: 502, error: "GitHub label API failed" };
  }
  return { ok: true, status: "labeled", label: decision.label };
}
