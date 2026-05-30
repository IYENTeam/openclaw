import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import {
  completeWithPreparedSimpleCompletionModel,
  extractAssistantText,
  prepareSimpleCompletionModelForAgent,
} from "openclaw/plugin-sdk/simple-completion-runtime";
import { withAbortTimeout } from "./timeouts.js";

const DEFAULT_THREAD_ROUTE_TIMEOUT_MS = 10_000;
const DISCORD_THREAD_ROUTE_MAX_TOKENS = 256;
const MAX_ROUTE_SOURCE_CHARS = 1_200;
const MAX_ROUTE_CHANNEL_CONTEXT_CHARS = 320;

const DISCORD_THREAD_ROUTE_SYSTEM_PROMPT = `You are OpenClaw's Discord session router.
Classify a main-channel message into exactly one route:
- main: quick chat, acknowledgements, greetings, tiny followups, or things that should stay in the channel's lightweight main session.
- new_thread: a distinct task, investigation, implementation request, research request, debugging request, long-running work, or anything likely to use tools or produce large context.
Return only one lowercase token: main or new_thread.`;

export type DiscordThreadRouteDecision = "main" | "new_thread";

export async function classifyDiscordThreadRoute(params: {
  cfg: OpenClawConfig;
  agentId: string;
  messageText: string;
  modelRef?: string;
  channelName?: string;
  channelDescription?: string;
  timeoutMs?: number;
}): Promise<DiscordThreadRouteDecision | null> {
  const sourceText = params.messageText.trim();
  if (!sourceText) {
    return "main";
  }

  const prepared = await prepareSimpleCompletionModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
    ...(params.modelRef ? { modelRef: params.modelRef } : {}),
    allowMissingApiKeyModes: ["aws-sdk"],
  });
  if ("error" in prepared) {
    const modelLabel = prepared.selection
      ? `${prepared.selection.provider}/${prepared.selection.modelId}`
      : "unknown";
    logVerbose(
      `discord-thread-route: ${prepared.error} (agent=${params.agentId}, model=${modelLabel})`,
    );
    return null;
  }

  try {
    const userMessage = buildThreadRouteUserMessage({
      sourceText: truncateSingleLine(sourceText, MAX_ROUTE_SOURCE_CHARS),
      channelName: params.channelName,
      channelDescription: params.channelDescription,
    });
    const timeoutMs = Math.max(
      100,
      Math.floor(params.timeoutMs ?? DEFAULT_THREAD_ROUTE_TIMEOUT_MS),
    );
    const response = await withAbortTimeout({
      timeoutMs,
      createTimeoutError: () => new Error(`discord-thread-route timed out after ${timeoutMs}ms`),
      run: async (signal) =>
        await completeWithPreparedSimpleCompletionModel({
          model: prepared.model,
          auth: prepared.auth,
          context: {
            systemPrompt: DISCORD_THREAD_ROUTE_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: userMessage,
                timestamp: Date.now(),
              },
            ],
          },
          options: {
            maxTokens: DISCORD_THREAD_ROUTE_MAX_TOKENS,
            signal,
          },
        }),
    });
    return normalizeDiscordThreadRouteDecision(extractAssistantText(response));
  } catch (err) {
    logVerbose(
      `discord-thread-route: classification failed for agent ${params.agentId}: ${String(err)}`,
    );
    return null;
  }
}

function buildThreadRouteUserMessage(params: {
  sourceText: string;
  channelName?: string;
  channelDescription?: string;
}): string {
  const lines: string[] = [];
  const channelName = normalizeContextField(params.channelName);
  const channelDescription = normalizeContextField(params.channelDescription);
  if (channelName) {
    lines.push(`Channel: ${channelName}`);
  }
  if (channelDescription) {
    lines.push(`Channel description: ${channelDescription}`);
  }
  lines.push(`Message:\n${params.sourceText}`);
  return lines.join("\n\n");
}

function normalizeContextField(raw: string | undefined): string | undefined {
  const value = raw?.trim().replace(/\s+/g, " ");
  if (!value) {
    return undefined;
  }
  return truncateSingleLine(value, MAX_ROUTE_CHANNEL_CONTEXT_CHARS);
}

function truncateSingleLine(value: string, maxChars: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxChars)}...`;
}

export function normalizeDiscordThreadRouteDecision(
  raw: string,
): DiscordThreadRouteDecision | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/["'`*_~]/g, "");
  const firstToken = normalized.split(/\s+/)[0] ?? "";
  if (firstToken === "main") {
    return "main";
  }
  if (firstToken === "new_thread" || firstToken === "new-thread" || firstToken === "thread") {
    return "new_thread";
  }
  return null;
}
