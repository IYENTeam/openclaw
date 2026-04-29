import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  PR_REVIEW_TRIGGER_DEFAULT_LABEL,
  type PrReviewTriggerPolicy,
  type PrReviewTriggerPullRequest,
  type PrReviewTriggerService,
} from "./pr-review-trigger.js";

const GITHUB_API = "https://api.github.com";

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error("invalid repo");
  }
  return { owner, name };
}

function resolveGithubToken(config: OpenClawConfig): string | undefined {
  const envName = config.iyensystem?.prReviewTrigger?.githubTokenEnv?.trim();
  if (envName) {
    return process.env[envName]?.trim() || undefined;
  }
  return (
    process.env.OPENCLAW_IYENSYSTEM_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    undefined
  );
}

function normalizeGithubLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }
  return labels
    .map((label) => {
      if (typeof label === "string") {
        return label.trim();
      }
      if (label && typeof label === "object") {
        const name = (label as { name?: unknown }).name;
        return typeof name === "string" ? name.trim() : "";
      }
      return "";
    })
    .filter(Boolean);
}

async function githubJson<T>(params: {
  token: string;
  path: string;
  method?: string;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(`${GITHUB_API}${params.path}`, {
    method: params.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
      "User-Agent": "OpenClaw-IYENsystem-PR-Review-Trigger",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function resolvePrReviewTriggerPolicy(config: OpenClawConfig): PrReviewTriggerPolicy {
  const cfg = config.iyensystem?.prReviewTrigger;
  return {
    reviewLabel: cfg?.reviewLabel?.trim() || PR_REVIEW_TRIGGER_DEFAULT_LABEL,
    includeDrafts: cfg?.includeDrafts === true,
    minChangedFiles: cfg?.minChangedFiles,
    minTotalChanges: cfg?.minTotalChanges,
  };
}

export function createPrReviewTriggerService(
  config: OpenClawConfig,
): PrReviewTriggerService | undefined {
  if (config.iyensystem?.enabled !== true || config.iyensystem.prReviewTrigger?.enabled !== true) {
    return undefined;
  }
  const token = resolveGithubToken(config);
  if (!token) {
    return undefined;
  }

  return {
    async getPullRequest(repo, pullNumber) {
      const { owner, name } = splitRepo(repo);
      const pr = await githubJson<Record<string, unknown>>({
        token,
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${pullNumber}`,
      });
      return {
        repo,
        number: pullNumber,
        title: typeof pr.title === "string" ? pr.title : "(untitled)",
        html_url: typeof pr.html_url === "string" ? pr.html_url : undefined,
        labels: normalizeGithubLabels(pr.labels),
        state: typeof pr.state === "string" ? pr.state.toLowerCase() : undefined,
        draft: pr.draft === true,
        merged: pr.merged === true,
        additions: Number.isInteger(pr.additions) ? (pr.additions as number) : undefined,
        deletions: Number.isInteger(pr.deletions) ? (pr.deletions as number) : undefined,
        changed_files: Number.isInteger(pr.changed_files)
          ? (pr.changed_files as number)
          : undefined,
        base_ref:
          pr.base &&
          typeof pr.base === "object" &&
          typeof (pr.base as { ref?: unknown }).ref === "string"
            ? (pr.base as { ref: string }).ref
            : undefined,
        head_ref:
          pr.head &&
          typeof pr.head === "object" &&
          typeof (pr.head as { ref?: unknown }).ref === "string"
            ? (pr.head as { ref: string }).ref
            : undefined,
        author:
          pr.user &&
          typeof pr.user === "object" &&
          typeof (pr.user as { login?: unknown }).login === "string"
            ? (pr.user as { login: string }).login
            : undefined,
      } satisfies PrReviewTriggerPullRequest;
    },
    async addLabels(repo, pullNumber, labels) {
      const { owner, name } = splitRepo(repo);
      await githubJson({
        token,
        method: "POST",
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${pullNumber}/labels`,
        body: { labels },
      });
    },
  };
}
