import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  PR_REVIEW_DECISION_DEFAULT_LABEL,
  type PrReviewDecisionPolicy,
  type PrReviewDecisionPullRequest,
  type PrReviewDecisionService,
} from "./pr-review-decision.js";

const GITHUB_API = "https://api.github.com";

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error("invalid repo");
  }
  return { owner, name };
}

function resolveGithubToken(config: OpenClawConfig): string | undefined {
  const envName = config.iyensystem?.prReviewDecision?.githubTokenEnv?.trim();
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
      "User-Agent": "OpenClaw-IYENsystem-PR-Review-Decision",
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

export function resolvePrReviewDecisionPolicy(config: OpenClawConfig): PrReviewDecisionPolicy {
  const cfg = config.iyensystem?.prReviewDecision;
  return {
    enabled: config.iyensystem?.enabled === true && cfg?.enabled === true,
    reviewLabel: cfg?.reviewLabel?.trim() || PR_REVIEW_DECISION_DEFAULT_LABEL,
    reReviewOnRequestChanges: cfg?.reReviewOnRequestChanges === true,
    allowApproval: cfg?.allowApproval === true,
    requireHumanApproval: cfg?.requireHumanApproval !== false,
    repoAllowlist: cfg?.repoAllowlist,
    iyenReviewerLogins: cfg?.iyenReviewerLogins,
    iyenAuthorLogins: cfg?.iyenAuthorLogins,
  };
}

export function createPrReviewDecisionService(
  config: OpenClawConfig,
): PrReviewDecisionService | undefined {
  const cfg = config.iyensystem?.prReviewDecision;
  if (config.iyensystem?.enabled !== true || cfg?.enabled !== true) {
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
        author:
          pr.user &&
          typeof pr.user === "object" &&
          typeof (pr.user as { login?: unknown }).login === "string"
            ? (pr.user as { login: string }).login
            : undefined,
        head_sha:
          pr.head &&
          typeof pr.head === "object" &&
          typeof (pr.head as { sha?: unknown }).sha === "string"
            ? (pr.head as { sha: string }).sha
            : undefined,
      } satisfies PrReviewDecisionPullRequest;
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
