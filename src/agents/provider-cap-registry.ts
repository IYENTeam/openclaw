import type { ModelAuthMode } from "./model-auth.js";

const ANTHROPIC_STANDARD_TOKENS = 200_000;
const ANTHROPIC_CONTEXT_1M_TOKENS = 1_048_576;

const ANTHROPIC_1M_MODEL_PREFIXES = ["claude-opus-4", "claude-sonnet-4"] as const;

const STATIC_HARD_CAPS: ReadonlyMap<string, number> = new Map([
  ["openai-codex/gpt-5.5", 200_000],
  ["openai-codex/gpt-5.4", 200_000],
  ["openai-codex/gpt-5.4-codex", 200_000],
  ["openai-codex", 200_000],

  ["closedrouter-openai/gpt-5.5", 200_000],
  ["closedrouter-openai/gpt-5.4", 200_000],
  ["closedrouter-openai/gpt-5.4-codex", 200_000],
  ["closedrouter-openai/gpt-4o", 128_000],
  ["closedrouter-openai/gpt-4o-mini", 128_000],
  ["closedrouter-openai/o3", 200_000],
  ["closedrouter-openai/o4-mini", 200_000],
  ["closedrouter-openai", 200_000],

  ["closedrouter/claude-sonnet-4-5-20250929", 200_000],
  ["closedrouter/claude-opus-4-5-20250929", 200_000],
  ["closedrouter/claude-opus-4-6", 200_000],
  ["closedrouter/claude-opus-4-7", 200_000],
  ["closedrouter", 200_000],

  ["closedrouter-gemini/gemini-2.5-pro", 1_000_000],
  ["closedrouter-gemini/gemini-2.5-flash", 1_000_000],
  ["closedrouter-gemini", 1_000_000],

  ["closedrouter-zai/glm-5", 200_000],
  ["closedrouter-zai/glm-5.1", 200_000],
  ["closedrouter-zai", 200_000],
]);

function isAnthropic1MModel(provider: string, model: string): boolean {
  const normalizedProvider = provider.trim().toLowerCase();
  if (normalizedProvider !== "anthropic") {
    return false;
  }
  const normalizedModel = model.trim().toLowerCase();
  return ANTHROPIC_1M_MODEL_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix));
}

export type ProviderHardCapLookup = {
  provider: string;
  model: string;
  context1mRequested?: boolean;
  credentialMode?: ModelAuthMode;
};

export function lookupProviderHardCap(params: ProviderHardCapLookup): number | undefined {
  const provider = params.provider.trim();
  const model = params.model.trim();
  if (provider === "" || model === "") {
    return undefined;
  }

  if (provider.toLowerCase() === "anthropic" && isAnthropic1MModel(provider, model)) {
    if (params.context1mRequested !== true) {
      return ANTHROPIC_STANDARD_TOKENS;
    }
    if (params.credentialMode !== undefined && params.credentialMode !== "api-key") {
      return ANTHROPIC_STANDARD_TOKENS;
    }
    return ANTHROPIC_CONTEXT_1M_TOKENS;
  }

  const qualifiedKey = `${provider}/${model}`;
  const direct = STATIC_HARD_CAPS.get(qualifiedKey);
  if (direct !== undefined) {
    return direct;
  }

  const providerFallback = STATIC_HARD_CAPS.get(provider);
  if (providerFallback !== undefined) {
    return providerFallback;
  }

  return undefined;
}

export function effectiveBudget(params: {
  configuredBudget?: number;
  hardCap?: number;
}): number | undefined {
  const safeConfigured =
    typeof params.configuredBudget === "number" &&
    Number.isFinite(params.configuredBudget) &&
    params.configuredBudget > 0
      ? params.configuredBudget
      : undefined;
  const safeHardCap =
    typeof params.hardCap === "number" && Number.isFinite(params.hardCap) && params.hardCap > 0
      ? params.hardCap
      : undefined;

  if (safeConfigured !== undefined && safeHardCap !== undefined) {
    return Math.min(safeConfigured, safeHardCap);
  }
  return safeConfigured ?? safeHardCap;
}

export const __testing = {
  ANTHROPIC_STANDARD_TOKENS,
  ANTHROPIC_CONTEXT_1M_TOKENS,
  STATIC_HARD_CAPS,
};
