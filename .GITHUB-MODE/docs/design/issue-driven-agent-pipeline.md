# Issue-Driven Agent Pipeline Design

## Purpose

This document describes how `.GITHUB-MODE` implements an issue-driven agent pipeline inspired by the `japer-technology/gitclaw` repository's architecture, adapted for the governance and security requirements of OpenClaw GitHub Mode.

For the full gitclaw analysis, see [gitclaw-a-simple-example.md](gitclaw-a-simple-example.md).

---

## 1) Architectural inspiration from gitclaw

The gitclaw repository demonstrates a minimal but effective pattern: GitHub issues as conversation interfaces, with repository-native workflows as the execution layer. The key patterns adapted for GitHub Mode are:

| gitclaw pattern                                       | GitHub Mode adaptation                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Issue/comment event triggers                          | `github-mode-issue-command.yml` triggers on `issue_comment` and `issues` events     |
| Author association gating (OWNER/MEMBER/COLLABORATOR) | Same association check, plus policy-gated trust authorization layer                 |
| Reaction-based progress signaling (eyes add/remove)   | `signal-reaction.ts` script and workflow steps for eyes reaction lifecycle          |
| Prompt extraction from event payload                  | Command parsing from `/openclaw <command> <target>` prefix in comments/titles       |
| Agent execution with output capture                   | openclaw agent engine execution with output piped to temp file                      |
| Comment-back response to issue                        | Agent response posted as issue comment with provenance metadata                     |
| Guaranteed cleanup in finally block                   | Reaction removal in `if: always()` step regardless of job outcome                   |
| Pre-agent security gates                              | Full pre-agent gate pipeline (skill-package-scan, lockfile-provenance, policy-eval) |

---

## 2) How the issue command pipeline works

### End-to-end sequence

1. User posts `/openclaw explain src/routing/agent.ts` as an issue comment (or opens an issue with that title).
2. Workflow triggers if actor has authorized association (OWNER, MEMBER, COLLABORATOR).
3. Eyes reaction added to the comment/issue to signal "agent is working".
4. Command parsed from event payload: `command=explain`, `target=src/routing/agent.ts`.
5. Command validated against allowed set (explain, refactor, test, diagram).
6. Pre-agent gates run in fail-closed order: skill-package-scan, lockfile-provenance, policy-eval.
7. Agent execution job builds openclaw from source and runs the agent engine.
8. Trust authorization and policy-gated adapter checks enforced before execution.
9. Agent output captured and posted as issue comment with provenance links.
10. Eyes reaction removed in cleanup step (always runs).

### Authorization model

gitclaw uses GitHub's `author_association` field to gate access. GitHub Mode preserves this as the first filter, then layers additional trust-level authorization:

- **Association gate (workflow-level `if:`):** Rejects NONE, FIRST_TIME_CONTRIBUTOR, FIRST_TIMER, MANNEQUIN associations. Rejects bot senders.
- **Command validation:** Only allowed commands (explain, refactor, test, diagram) proceed.
- **Pre-agent gates:** Fail-closed skill/package scan, lockfile/provenance, and policy evaluation.
- **Trust authorization:** `enforce-trust-authorization.ts` validates actor trust level for adapter usage.
- **Policy-gated adapter:** `enforce-policy-gated-adapter.ts` validates the specific adapter/action combination.

### Prompt selection

Following gitclaw's pattern:

- **Issue comment events:** Prompt is the comment body (after stripping the `/openclaw` prefix).
- **Issue opened events:** Prompt is the issue title (after stripping prefix). Body provides additional context.

---

## 3) Reaction signaling

The reaction lifecycle mirrors gitclaw's preinstall/cleanup pattern:

### Add reaction (start of pipeline)

- Runs immediately after checkout, before dependency installation.
- Adds `eyes` (👀) reaction to the triggering comment or issue.
- Captures `reaction_id` and `reaction_target` for cleanup.
- Non-fatal: reaction add failures do not block the pipeline.

### Remove reaction (guaranteed cleanup)

- Runs in an `if: always()` step, so it executes regardless of job success/failure.
- Uses the captured `reaction_id` to delete the specific reaction.
- Non-fatal: cleanup failures are logged but do not affect pipeline outcome.

### Implementation

The `signal-reaction.ts` script provides pure, testable functions for:

- Parsing event context from GitHub Actions environment
- Determining reaction target (comment vs issue)
- Building `gh api` command arguments for add/remove
- Extracting prompts from event payloads
- Validating author association

---

## 4) Key differences from gitclaw

### State persistence

gitclaw uses git-committed session files (`state/issues/`, `state/sessions/`) as its persistent memory layer. This works because gitclaw uses a simple `push to main` model.

GitHub Mode operates under stricter constraints:

- **No direct pushes to protected branches.** All mutations go through PR flow.
- **Stateless ephemeral runners.** GitHub Actions runners are fresh per job.
- **External state required.** Context must be externalized to survive runner teardown.

For the issue command pipeline, state persistence is handled through:

- GitHub issue thread itself (conversation history is durable).
- Workflow artifacts (gate evidence, provenance metadata, agent output).
- Future: Task 4.7 persistent memory adapter for cross-run agent context.

### Security model

gitclaw uses minimal security (association check + token scopes). GitHub Mode adds:

- Fail-closed pre-agent gates before any agent execution.
- Trust-level authorization layer.
- Policy-gated adapter invocation.
- Provenance metadata embedding in all outputs.
- SHA-pinned third-party actions.
- Explicit least-privilege permissions at workflow and job level.

### Command interface

gitclaw treats any issue/comment as a prompt. GitHub Mode uses a structured command prefix (`/openclaw <command> <target>`) to:

- Clearly delineate agent-targeted messages from regular discussion.
- Validate commands against an allowed set before execution.
- Route to appropriate agent behavior (explain, refactor, test, diagram).

---

## 5) Relationship to existing workflows

The issue command workflow complements the existing command infrastructure:

| Workflow                            | Trigger                               | Use case                             |
| ----------------------------------- | ------------------------------------- | ------------------------------------ |
| `github-mode-command.yml`           | `workflow_dispatch`                   | Manual dispatch with explicit inputs |
| `github-mode-agent-run.yml`         | `workflow_dispatch` / `workflow_call` | Agent execution for other workflows  |
| **`github-mode-issue-command.yml`** | **`issue_comment` / `issues`**        | **Issue-driven command interaction** |
| `github-mode-bot-pr.yml`            | `workflow_dispatch` / `workflow_call` | Bot PR creation from agent output    |

The issue command workflow reuses:

- The same pre-agent gate pipeline (`run-pre-agent-gates.ts`)
- The same trust authorization layer (`enforce-trust-authorization.ts`)
- The same policy-gated adapter checks (`enforce-policy-gated-adapter.ts`)
- The same provenance validation (`validate-provenance-metadata.ts`)
- The same openclaw agent engine execution pattern

---

## 6) Future enhancements

Drawing further from gitclaw patterns, future iterations could add:

1. **Session continuity across comments.** Map issue numbers to agent sessions so follow-up comments resume context (gitclaw's `state/issues/<n>.json` pattern, adapted for external storage per Task 4.7).
2. **Structured agent output parsing.** Extract specific sections from agent JSON output for richer issue comments (gitclaw's `tac | jq` output extraction pattern).
3. **Retry-on-conflict for state writes.** When the persistent memory adapter lands, implement gitclaw's rebase-retry loop for concurrent state updates.
4. **Multi-issue orchestration.** Enable agents to reference and act across related issues, building on the collaboration envelope design.
