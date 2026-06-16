// IYEN F-step: tool-result externalization (storage-time guard)
//
// 목적: 세션 jsonl 에 큰 tool result 원문이 누적되지 않도록,
// session save / append 직전에 호출하여 메시지 객체를 in-place 변환한다.
//
// 정책 (보수적 default):
//  - 단일 텍스트 블록의 길이가 hardCapChars 를 초과하면 head + pointer + 메타로 치환.
//  - 이미 externalized:true 마킹된 블록은 재처리하지 않는다.
//  - text 가 아닌 블록 (image 등) 은 절대 건드리지 않는다.
//  - storage hook 이 주어지면 원문을 storage 에 저장하고 returned uri 를 pointer 로 사용한다.
//    storage hook 이 없으면 pointer 는 null 로 남겨 호출자가 별도로 보존을 책임지게 한다.
//
// 이 함수는 session 저장 단계 전용이다. 모델로 보내는 prompt assemble 시점의
// 동작 (truncateOversizedToolResultsInMessages) 과 분리되어 있다.

import type { AgentMessage } from "@mariozechner/pi-agent-core";

export type ExternalizationStorageWriter = (params: {
  text: string;
  byteLength: number;
  ordinal: number; // 메시지 안에서 몇 번째 텍스트 블록인지
}) => Promise<{ uri: string } | null> | { uri: string } | null;

export interface ExternalizationOptions {
  /** 단일 텍스트 블록 hard cap (chars). 기본 16_384. */
  hardCapChars?: number;
  /** head 로 남길 길이 (chars). 기본 1_024. */
  headChars?: number;
  /** 외부화 결과를 저장하는 hook. 미지정이면 pointer 는 null. */
  storageWriter?: ExternalizationStorageWriter;
}

export interface ExternalizationResult {
  /** 변환된 메시지 (원본 mutate 하지 않음) */
  message: AgentMessage;
  /** 이번 메시지에서 몇 개 블록이 외부화되었나 */
  externalizedBlocks: number;
  /** 외부화된 원문 총 byte 수 (UTF-8 기준 추정 = chars*1) */
  externalizedChars: number;
}

interface TextBlock {
  type: "text";
  text: string;
  externalized?: boolean;
  externalArtifact?: string | null;
  originalChars?: number;
}

interface ExternalizedBlock extends TextBlock {
  externalized: true;
  externalArtifact: string | null;
  originalChars: number;
}

const DEFAULT_HARD_CAP = 16_384;
const DEFAULT_HEAD_CHARS = 1_024;

function isTextBlock(block: unknown): block is TextBlock {
  return (
    !!block &&
    typeof block === "object" &&
    (block as { type?: unknown }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  );
}

function alreadyExternalized(block: TextBlock): boolean {
  return block.externalized === true;
}

function makeHead(text: string, headChars: number): string {
  if (text.length <= headChars) return text;
  return text.slice(0, headChars);
}

function buildExternalizedBlock(params: {
  block: TextBlock;
  uri: string | null;
  headChars: number;
}): ExternalizedBlock {
  const { block, uri, headChars } = params;
  const head = makeHead(block.text, headChars);
  const truncationNote =
    block.text.length > head.length
      ? `\n\n[…externalized: ${block.text.length} chars total${uri ? `, see ${uri}` : ""}]`
      : "";
  return {
    type: "text",
    text: head + truncationNote,
    externalized: true,
    externalArtifact: uri,
    originalChars: block.text.length,
  };
}

/**
 * 단일 메시지를 외부화한다 (async). storageWriter 가 지정된 경우 hook 을 호출한다.
 * 원본 메시지는 변경하지 않는다.
 */
export async function externalizeToolResultMessage(
  msg: AgentMessage,
  options: ExternalizationOptions = {},
): Promise<ExternalizationResult> {
  if ((msg as { role?: string }).role !== "toolResult") {
    return { message: msg, externalizedBlocks: 0, externalizedChars: 0 };
  }
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return { message: msg, externalizedBlocks: 0, externalizedChars: 0 };
  }
  const hardCap = Math.max(1, options.hardCapChars ?? DEFAULT_HARD_CAP);
  const headChars = Math.max(0, Math.min(hardCap - 1, options.headChars ?? DEFAULT_HEAD_CHARS));

  let externalizedBlocks = 0;
  let externalizedChars = 0;
  const newContent: unknown[] = [];
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (!isTextBlock(block) || alreadyExternalized(block) || block.text.length <= hardCap) {
      newContent.push(block);
      continue;
    }
    let uri: string | null = null;
    if (options.storageWriter) {
      try {
        const r = await options.storageWriter({
          text: block.text,
          byteLength: block.text.length,
          ordinal: i,
        });
        uri = r?.uri ?? null;
      } catch {
        uri = null;
      }
    }
    const replaced = buildExternalizedBlock({ block, uri, headChars });
    newContent.push(replaced);
    externalizedBlocks += 1;
    externalizedChars += block.text.length;
  }

  if (externalizedBlocks === 0) {
    return { message: msg, externalizedBlocks, externalizedChars };
  }
  return {
    message: { ...msg, content: newContent } as AgentMessage,
    externalizedBlocks,
    externalizedChars,
  };
}

/**
 * 동기 변환. storageWriter 를 사용할 수 없는 환경 (예: 단순 메모리 다이어트) 용.
 */
export function externalizeToolResultMessageSync(
  msg: AgentMessage,
  options: Omit<ExternalizationOptions, "storageWriter"> & {
    storageRefBuilder?: (params: { byteLength: number; ordinal: number }) => string | null;
  } = {},
): ExternalizationResult {
  if ((msg as { role?: string }).role !== "toolResult") {
    return { message: msg, externalizedBlocks: 0, externalizedChars: 0 };
  }
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return { message: msg, externalizedBlocks: 0, externalizedChars: 0 };
  }
  const hardCap = Math.max(1, options.hardCapChars ?? DEFAULT_HARD_CAP);
  const headChars = Math.max(0, Math.min(hardCap - 1, options.headChars ?? DEFAULT_HEAD_CHARS));
  let externalizedBlocks = 0;
  let externalizedChars = 0;
  const newContent: unknown[] = [];
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (!isTextBlock(block) || alreadyExternalized(block) || block.text.length <= hardCap) {
      newContent.push(block);
      continue;
    }
    const uri = options.storageRefBuilder
      ? options.storageRefBuilder({ byteLength: block.text.length, ordinal: i })
      : null;
    const replaced = buildExternalizedBlock({ block, uri, headChars });
    newContent.push(replaced);
    externalizedBlocks += 1;
    externalizedChars += block.text.length;
  }
  if (externalizedBlocks === 0) {
    return { message: msg, externalizedBlocks, externalizedChars };
  }
  return {
    message: { ...msg, content: newContent } as AgentMessage,
    externalizedBlocks,
    externalizedChars,
  };
}

/**
 * 메시지 배열 일괄 처리. session save 직전에 호출.
 */
export async function externalizeOversizedToolResults(
  messages: AgentMessage[],
  options: ExternalizationOptions = {},
): Promise<{
  messages: AgentMessage[];
  externalizedMessages: number;
  externalizedBlocks: number;
  externalizedChars: number;
}> {
  let externalizedMessages = 0;
  let externalizedBlocks = 0;
  let externalizedChars = 0;
  const out: AgentMessage[] = [];
  for (const msg of messages) {
    const r = await externalizeToolResultMessage(msg, options);
    if (r.externalizedBlocks > 0) {
      externalizedMessages += 1;
      externalizedBlocks += r.externalizedBlocks;
      externalizedChars += r.externalizedChars;
    }
    out.push(r.message);
  }
  return { messages: out, externalizedMessages, externalizedBlocks, externalizedChars };
}
