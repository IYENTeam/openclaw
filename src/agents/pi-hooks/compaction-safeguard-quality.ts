import { extractKeywords, isQueryStopWordToken } from "../../memory-host-sdk/query.js";
import { localeLowercasePreservingWhitespace } from "../../shared/string-coerce.js";
import type { CompactionSummarizationInstructions } from "../compaction.js";
import { wrapUntrustedPromptDataBlock } from "../sanitize-for-prompt.js";

const MAX_EXTRACTED_IDENTIFIERS = 12;
const MAX_UNTRUSTED_INSTRUCTION_CHARS = 4000;
const MAX_ASK_OVERLAP_TOKENS = 12;
const MIN_ASK_OVERLAP_TOKENS_FOR_DOUBLE_MATCH = 3;
const REQUIRED_SUMMARY_SECTIONS = [
  "## Active Task",
  "## Completed Actions",
  "## Key Decisions",
  "## Resolved Questions",
  "## Pending Questions",
  "## Final Artifacts / URLs / IDs",
  "## Last Verification",
  "## Remaining Work",
  "## Blockers",
  "## Safety / Do-Not-Do",
  "## Critical Context",
] as const;
const STRICT_EXACT_IDENTIFIERS_INSTRUCTION =
  "For ## Final Artifacts / URLs / IDs and ## Critical Context, preserve literal values exactly as seen (IDs, URLs, file paths, ports, hashes, dates, times).";
const POLICY_OFF_EXACT_IDENTIFIERS_INSTRUCTION =
  "For ## Final Artifacts / URLs / IDs and ## Critical Context, include identifiers only when needed for continuity; do not enforce literal-preservation rules.";

export function wrapUntrustedInstructionBlock(label: string, text: string): string {
  return wrapUntrustedPromptDataBlock({
    label,
    text,
    maxChars: MAX_UNTRUSTED_INSTRUCTION_CHARS,
  });
}

function resolveExactIdentifierSectionInstruction(
  summarizationInstructions?: CompactionSummarizationInstructions,
): string {
  const policy = summarizationInstructions?.identifierPolicy ?? "strict";
  if (policy === "off") {
    return POLICY_OFF_EXACT_IDENTIFIERS_INSTRUCTION;
  }
  if (policy === "custom") {
    const custom = summarizationInstructions?.identifierInstructions?.trim();
    if (custom) {
      const customBlock = wrapUntrustedInstructionBlock(
        "For ## Critical Context, apply this operator-defined policy text",
        custom,
      );
      if (customBlock) {
        return customBlock;
      }
    }
  }
  return STRICT_EXACT_IDENTIFIERS_INSTRUCTION;
}

export function buildCompactionStructureInstructions(
  customInstructions?: string,
  summarizationInstructions?: CompactionSummarizationInstructions,
): string {
  const identifierSectionInstruction =
    resolveExactIdentifierSectionInstruction(summarizationInstructions);
  const sectionsTemplate = [
    "Produce a compact, factual summary with these exact section headings:",
    ...REQUIRED_SUMMARY_SECTIONS,
    identifierSectionInstruction,
    "In ## Active Task, include the current objective and source ticket/channel when available.",
    "In ## Completed Actions, include only actions that actually completed and caused observable artifacts or state changes.",
    "In ## Final Artifacts / URLs / IDs, preserve files, PR/Issue URLs, ticket IDs, job/session/workspace IDs, and other exact identifiers needed to resume work.",
    "In ## Last Verification, include the last verification command or inspection method and result; write `검증 없음` if no verification happened.",
    "In ## Remaining Work, separate immediately actionable work from work requiring external input, approval, credentials, or user decisions.",
    "In ## Blockers, include only genuine blockers; do not present work the assistant can do now as blocked.",
    "In ## Safety / Do-Not-Do, preserve privacy/security/channel-isolation cautions and do not re-expose raw secret values.",
    "Compress tool outputs to one-line summaries, e.g. `[exec] npm test → exit 0 (47 lines)`.",
    "Do not omit unresolved asks from the user.",
    "When prior compaction summaries are present, re-distill them with new messages and remove stale duplicate detail.",
  ].join("\n");
  const custom = customInstructions?.trim();
  if (!custom) {
    return sectionsTemplate;
  }
  const customBlock = wrapUntrustedInstructionBlock("Additional context from /compact", custom);
  if (!customBlock) {
    return sectionsTemplate;
  }
  return `${sectionsTemplate}\n\n${customBlock}`;
}

function normalizedSummaryLines(summary: string): string[] {
  return summary
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function hasRequiredSummarySections(summary: string): boolean {
  const lines = normalizedSummaryLines(summary);
  let cursor = 0;
  for (const heading of REQUIRED_SUMMARY_SECTIONS) {
    const index = lines.findIndex((line, lineIndex) => lineIndex >= cursor && line === heading);
    if (index < 0) {
      return false;
    }
    cursor = index + 1;
  }
  return true;
}

export function buildStructuredFallbackSummary(
  previousSummary: string | undefined,
  _summarizationInstructions?: CompactionSummarizationInstructions,
): string {
  const trimmedPreviousSummary = previousSummary?.trim() ?? "";
  if (trimmedPreviousSummary && hasRequiredSummarySections(trimmedPreviousSummary)) {
    return trimmedPreviousSummary;
  }
  return [
    "## Active Task",
    trimmedPreviousSummary || "No prior history.",
    "",
    "## Completed Actions",
    "None.",
    "",
    "## Key Decisions",
    "None.",
    "",
    "## Resolved Questions",
    "None.",
    "",
    "## Pending Questions",
    "None.",
    "",
    "## Final Artifacts / URLs / IDs",
    "None captured.",
    "",
    "## Last Verification",
    "검증 없음",
    "",
    "## Remaining Work",
    "None.",
    "",
    "## Blockers",
    "None.",
    "",
    "## Safety / Do-Not-Do",
    "None.",
    "",
    "## Critical Context",
    "None captured.",
  ].join("\n");
}

export function appendSummarySection(summary: string, section: string): string {
  if (!section) {
    return summary;
  }
  if (!summary.trim()) {
    return section.trimStart();
  }
  return `${summary}${section}`;
}

function sanitizeExtractedIdentifier(value: string): string {
  return value
    .trim()
    .replace(/^[("'`[{<]+/, "")
    .replace(/[)\]"'`,;:.!?<>]+$/, "");
}

function isPureHexIdentifier(value: string): boolean {
  return /^[A-Fa-f0-9]{8,}$/.test(value);
}

function normalizeOpaqueIdentifier(value: string): string {
  return isPureHexIdentifier(value) ? value.toUpperCase() : value;
}

function summaryIncludesIdentifier(summary: string, identifier: string): boolean {
  if (isPureHexIdentifier(identifier)) {
    return summary.toUpperCase().includes(identifier.toUpperCase());
  }
  return summary.includes(identifier);
}

export function extractOpaqueIdentifiers(text: string): string[] {
  const matches =
    text.match(
      /([A-Fa-f0-9]{8,}|https?:\/\/\S+|\/[\w.-]{2,}(?:\/[\w.-]+)+|[A-Za-z]:\\[\w\\.-]+|[A-Za-z0-9._-]+\.[A-Za-z0-9._/-]+:\d{1,5}|\b\d{6,}\b)/g,
    ) ?? [];
  return Array.from(
    new Set(
      matches
        .map((value) => sanitizeExtractedIdentifier(value))
        .map((value) => normalizeOpaqueIdentifier(value))
        .filter((value) => value.length >= 4),
    ),
  ).slice(0, MAX_EXTRACTED_IDENTIFIERS);
}

function tokenizeAskOverlapText(text: string): string[] {
  const normalized = localeLowercasePreservingWhitespace(text.normalize("NFKC")).trim();
  if (!normalized) {
    return [];
  }
  const keywords = extractKeywords(normalized);
  if (keywords.length > 0) {
    return keywords;
  }
  return normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function hasAskOverlap(summary: string, latestAsk: string | null): boolean {
  if (!latestAsk) {
    return true;
  }
  const askTokens = Array.from(new Set(tokenizeAskOverlapText(latestAsk))).slice(
    0,
    MAX_ASK_OVERLAP_TOKENS,
  );
  if (askTokens.length === 0) {
    return true;
  }
  const meaningfulAskTokens = askTokens.filter((token) => {
    if (token.length <= 1) {
      return false;
    }
    if (isQueryStopWordToken(token)) {
      return false;
    }
    return true;
  });
  const tokensToCheck = meaningfulAskTokens.length > 0 ? meaningfulAskTokens : askTokens;
  if (tokensToCheck.length === 0) {
    return true;
  }
  const summaryTokens = new Set(tokenizeAskOverlapText(summary));
  let overlapCount = 0;
  for (const token of tokensToCheck) {
    if (summaryTokens.has(token)) {
      overlapCount += 1;
    }
  }
  const requiredMatches =
    tokensToCheck.length >= MIN_ASK_OVERLAP_TOKENS_FOR_DOUBLE_MATCH ? 2 : tokensToCheck.length;
  return overlapCount >= requiredMatches;
}

export function auditSummaryQuality(params: {
  summary: string;
  identifiers: string[];
  latestAsk: string | null;
  identifierPolicy?: CompactionSummarizationInstructions["identifierPolicy"];
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const lines = new Set(normalizedSummaryLines(params.summary));
  for (const section of REQUIRED_SUMMARY_SECTIONS) {
    if (!lines.has(section)) {
      reasons.push(`missing_section:${section}`);
    }
  }
  const enforceIdentifiers = (params.identifierPolicy ?? "strict") === "strict";
  if (enforceIdentifiers) {
    const missingIdentifiers = params.identifiers.filter(
      (identifier) => !summaryIncludesIdentifier(params.summary, identifier),
    );
    if (missingIdentifiers.length > 0) {
      reasons.push(`missing_identifiers:${missingIdentifiers.slice(0, 3).join(",")}`);
    }
  }
  if (!hasAskOverlap(params.summary, params.latestAsk)) {
    reasons.push("latest_user_ask_not_reflected");
  }
  return { ok: reasons.length === 0, reasons };
}
