import type {
  AgentDefaultsConfig,
  TaskDraftGateConfig,
} from "../../config/types.agent-defaults.js";
import type { TemplateContext } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import type { FollowupRun, QueueSettings } from "./queue.js";

const DEFAULT_BYPASS_PREFIXES = ["ㄱㄱ", "ㅇㅇ", "해", "진행", "그렇게 해"];
const DEFAULT_TASK_HINTS = [
  "고쳐",
  "수정",
  "구현",
  "만들",
  "추가",
  "삭제",
  "정리",
  "조사",
  "확인",
  "리뷰",
  "테스트",
  "배포",
  "설정",
  "fix",
  "implement",
  "add",
  "remove",
  "review",
  "test",
  "deploy",
  "configure",
];

function normalize(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLower(value: string | undefined | null): string | undefined {
  return normalize(value)?.toLowerCase();
}

function hasAnyMatch(value: string | undefined, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) {
    return true;
  }
  if (!value) {
    return false;
  }
  const normalizedValue = value.toLowerCase();
  return allowed.some((entry) => entry.trim().toLowerCase() === normalizedValue);
}

function resolveDestination(ctx: TemplateContext): string | undefined {
  return (
    normalize(ctx.OriginatingTo) ??
    normalize(ctx.To) ??
    normalize(ctx.NativeChannelId) ??
    normalize(ctx.GroupChannel)
  );
}

function resolvePromptText(ctx: TemplateContext, fallback: string): string {
  return (
    normalize(ctx.BodyForCommands) ??
    normalize(ctx.CommandBody) ??
    normalize(ctx.RawBody) ??
    normalize(ctx.BodyStripped) ??
    normalize(ctx.Body) ??
    fallback.trim()
  );
}

function startsWithAny(text: string, prefixes: string[]): boolean {
  const trimmed = text.trim();
  return prefixes.some((prefix) => trimmed.startsWith(prefix));
}

function looksLikeTaskRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return DEFAULT_TASK_HINTS.some((hint) => lower.includes(hint));
}

export function shouldApplyTaskDraftGate(params: {
  agentDefaults?: AgentDefaultsConfig;
  sessionCtx: TemplateContext;
  followupRun: FollowupRun;
  resolvedQueue: QueueSettings;
  isHeartbeat?: boolean;
  isActive?: boolean;
  resetTriggered?: boolean;
}): boolean {
  const gate = params.agentDefaults?.taskDraftGate;
  if (gate?.enabled !== true) {
    return false;
  }
  if (params.isHeartbeat || params.resetTriggered || params.isActive) {
    return false;
  }
  // If this turn was already enqueued by the draft gate, let it execute normally.
  if (params.followupRun.run.taskDraftGateContinuation === true) {
    return false;
  }
  // Avoid changing explicit queue/followup semantics while introducing the gate.
  if (params.resolvedQueue.mode !== "interrupt" && params.resolvedQueue.mode !== "queue") {
    return false;
  }

  const provider = normalizeLower(params.sessionCtx.Provider ?? params.sessionCtx.Surface);
  const originatingChannel = normalizeLower(params.sessionCtx.OriginatingChannel);
  if (!hasAnyMatch(originatingChannel ?? provider, gate.channels)) {
    return false;
  }

  if (!hasAnyMatch(resolveDestination(params.sessionCtx), gate.targets)) {
    return false;
  }

  const chatType = normalizeLower(params.sessionCtx.ChatType);
  const allowedChatTypes = gate.chatTypes?.length ? gate.chatTypes : ["group", "channel"];
  if (!chatType || !allowedChatTypes.includes(chatType as "direct" | "dm" | "group" | "channel")) {
    return false;
  }

  const text = resolvePromptText(
    params.sessionCtx,
    params.followupRun.summaryLine ?? params.followupRun.prompt,
  );
  if (!text) {
    return false;
  }
  const bypassPrefixes = gate.bypassPrefixes?.length
    ? gate.bypassPrefixes
    : DEFAULT_BYPASS_PREFIXES;
  if (startsWithAny(text, bypassPrefixes)) {
    return false;
  }
  return looksLikeTaskRequest(text);
}

function inferRisk(text: string): "high" | "medium" | "low" {
  if (
    /\b(deploy|release|restart|dns|secret|token|password|credential|permission|delete|drop|rm\b)/i.test(
      text,
    )
  ) {
    return "high";
  }
  if (
    /\b(config|setting|merge|push|write|edit|modify)\b/i.test(text) ||
    /설정|배포|삭제|권한|토큰|비밀|수정/.test(text)
  ) {
    return "medium";
  }
  return "low";
}

function inferAction(text: string): string {
  if (/리뷰|review/i.test(text)) {
    return "대상 diff/PR을 확인하고 판정 근거를 남깁니다.";
  }
  if (/테스트|test|재현/i.test(text)) {
    return "재현/테스트 명령부터 실행하고 결과 로그를 확인합니다.";
  }
  if (/설정|config|configure/i.test(text)) {
    return "관련 설정 스키마와 현재값을 확인한 뒤 최소 변경으로 반영합니다.";
  }
  return "관련 코드/문서 경로와 현재 상태를 확인한 뒤 최소 변경으로 처리합니다.";
}

export function buildTaskDraftGateReply(params: {
  sessionCtx: TemplateContext;
  followupRun: FollowupRun;
}): ReplyPayload {
  const text = resolvePromptText(
    params.sessionCtx,
    params.followupRun.summaryLine ?? params.followupRun.prompt,
  );
  const risk = inferRisk(text);
  const approval = risk === "high" ? "필요할 수 있음" : "없음";
  return {
    text: [
      "📋 **Task Draft**",
      "목적: 요청한 작업을 실행 가능한 단위로 확인/처리합니다.",
      "범위: 현재 요청과 직접 관련된 파일/설정/검증까지만 봅니다.",
      `첫 액션: ${inferAction(text)}`,
      `Risk: ${risk}`,
      `승인 필요: ${approval}`,
      "",
      "이 Draft 뒤에 런타임이 같은 요청을 자동 실행 큐로 넘깁니다.",
    ].join("\n"),
  };
}
