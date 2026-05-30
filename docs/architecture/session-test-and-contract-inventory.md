---
title: Session Test and Contract Inventory
sidebarTitle: Session test inventory
description: Current validation, identity parsing, and extension contract inventory for session refactors.
read_when:
  - Adding session fixtures or compatibility tests
  - Changing session identity resolution or plugin/channel session contracts
---

# Session Test and Contract Inventory

## Validation commands

- Targeted session tests: `pnpm test src/config/sessions/domain/*.test.ts` and existing focused files such as `src/config/sessions/session-key.test.ts`, `src/config/sessions/store.session-key-normalization.test.ts`, `src/config/sessions/store-read.test.ts`, `src/config/sessions/store.lock.test.ts`, and `src/config/sessions/store.pruning.test.ts`.
- Core test typecheck: `pnpm tsgo:core:test`.
- Changed gate: `pnpm check:changed`; on maintainer machines broad changed gates should run in Testbox by default.
- Formatting: `pnpm exec oxfmt --check --threads=1 <files...>`.

## Existing fixture and coverage notes

- Identity: `src/routing/session-key.test.ts`, `src/config/sessions/session-key.test.ts`, `src/config/sessions/explicit-session-key-normalization.test.ts`, and `src/config/sessions/store.session-key-normalization.test.ts` cover agent prefixes, legacy/case aliases, Discord direct/channel normalization, cron, subagent, ACP, and thread suffixes.
- Projection: Gateway list rows are currently exercised indirectly through `src/gateway/session-utils.ts` callers and UI tests; the new projection tier unit tests cover minimal projection lightness. Additional list integration fixtures should cover minimal/display/details/diagnostic modes before broad adoption.
- Manifest: transcript files are covered by `src/config/sessions/transcript.test.ts` and `src/agents/session-file-repair.test.ts`; a future manifest index needs separate synthetic stores and transcript-only fixtures.
- Transaction: store locking has `src/config/sessions/store.lock.test.ts`; transaction markers still need tests once the mutation API owns writes.
- Retention: cleanup/pruning behavior is covered by `src/config/sessions/store.pruning.test.ts` and `src/config/sessions/store.pruning.integration.test.ts`; typed retention classes now have preservation-biased unit tests.
- Reconciliation: startup/runtime reconciliation remains a gap. Runtime-boundary helpers now assert that persisted running state is a recovery hint, not live proof.

## Identity parser and resolution map

- `src/config/sessions/store-entry.ts`: canonical store-key normalization and case-insensitive legacy entry lookup.
- `src/routing/session-key.ts`: agent-prefixed key construction, request/store conversion, agent id normalization, and key-shape classification.
- `src/sessions/session-key-utils.ts`: shared predicates and parsers for agent keys, cron, ACP, subagent, thread suffixes, raw group/channel references, and parent-thread resolution.
- `src/gateway/sessions-resolve.ts`: public Gateway session lookup and ambiguous `sessionId` behavior.
- `src/gateway/session-store-key.ts`: Gateway store key canonicalization boundary.
- `src/commands/sessions.ts` and `src/commands/sessions-table.ts`: CLI classification, display, and row formatting.
- `ui/src/ui/session-key.ts`, `ui/src/ui/controllers/sessions.ts`, `ui/src/ui/views/sessions.ts`, and `ui/src/ui/chat/session-cache.ts`: Control UI key parsing, row display, caching, filtering, and navigation.

Expected edge behavior: ambiguous sessionId resolution must remain explicit; deleted agent and legacy case variants must remain readable; heartbeat, subagent, ACP, cron, label, and thread keys must classify without unsafe path behavior.

## Plugin, channel, ACP, cron, heartbeat, and subagent contracts

- Plugins own only `pluginExtensions[pluginId][namespace]`, their own `pluginNextTurnInjections`, and their own `pluginDebugEntries`. Plugins must not write arbitrary core-owned `SessionEntry` fields through extension slots.
- ACP owns `acp` metadata and may update ACP identity/running state through ACP session manager code, but core reconciliation still owns whether persisted running state is live.
- Channels own normalized identity inputs: channel id, account id, sender/group/thread ids, group subject, and delivery context. Channel code must use documented SDK/core seams rather than writing unrelated session state.
- Cron owns cron delivery/session targets and isolated cron-run keys; retention should distinguish durable cron definitions from cron-run artifacts.
- Heartbeat owns `lastHeartbeatText`, `lastHeartbeatSentAt`, `heartbeatIsolatedBaseSessionKey`, and `heartbeatTaskState`; synthetic heartbeat sessions are not human-facing by default.
- Subagents own lineage established at spawn time: `spawnedBy`, `spawnedWorkspaceDir`, `parentSessionKey`, `forkedFromParent`, `spawnDepth`, `subagentRole`, `subagentControlScope`, and `pluginOwnerId` when the plugin runtime creates a subagent.
