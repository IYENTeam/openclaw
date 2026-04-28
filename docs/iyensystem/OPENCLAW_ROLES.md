# OpenClaw ↔ IYENsystem role contract

This document defines the first safe-default integration boundary between OpenClaw and IYENsystem.

## Roles

- **clawhip** is the ingress bridge. GitHub/PR events must arrive through clawhip-formatted hook payloads; OpenClaw must not bypass clawhip or post directly to Discord for this flow.
- **OpenClaw gateway** owns authenticated webhook handling, payload parsing, policy checks, and idempotent GitHub label application.
- **IYENsystem** owns downstream review orchestration after a maintainer-visible label is present.
- **Humans/maintainers** retain approval, merge, close, and release authority.

## PR review trigger

Endpoint: `POST /hooks/pr-review-trigger`

Expected request shape mirrors existing clawhip hook text payloads:

```json
{
  "text": "[clawhip:github.pr-opened] ...\n\nPayload: { ... }",
  "mode": "now"
}
```

The embedded `Payload:` JSON may be either a simplified object:

```json
{
  "repo": "owner/name",
  "number": 123,
  "title": "PR title",
  "labels": [],
  "action": "opened",
  "changed_files": 2,
  "additions": 10,
  "deletions": 1
}
```

or a GitHub-style object containing `repository.full_name` and `pull_request`.

## Safe defaults

The integration is disabled unless all of these are true:

```json
{
  "iyensystem": {
    "enabled": true,
    "prReviewTrigger": {
      "enabled": true
    }
  }
}
```

A GitHub token must be provided via `iyensystem.prReviewTrigger.githubTokenEnv`, `OPENCLAW_IYENSYSTEM_GITHUB_TOKEN`, or `GITHUB_TOKEN`.

Default policy:

- apply label: `iyen:review`
- skip PRs that are already labeled with the review label
- skip closed or merged PRs
- skip draft PRs unless `includeDrafts: true`
- when present, require at least one changed file and one total line change
- never approve, merge, close, or comment as part of this trigger

## Idempotency and authority

The hook action is intentionally limited to adding a label through the GitHub Issues labels API. GitHub label addition is idempotent, and OpenClaw checks existing labels first to avoid duplicate work. The label is a request for IYENsystem review, not approval or merge authority.
