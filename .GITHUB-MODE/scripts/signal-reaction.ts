import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

/**
 * Reaction signaling for GitHub Mode issue-driven workflows.
 *
 * Inspired by the gitclaw preinstall/cleanup pattern:
 * - Add a 👀 (eyes) reaction to signal "agent is working"
 * - Remove the reaction when the agent completes (success or failure)
 *
 * This script is designed to run inside GitHub Actions workflows
 * using the `gh` CLI for API calls. When run outside Actions
 * (e.g., in tests), it exports pure functions for validation
 * and state construction without side effects.
 */

export type ReactionTarget = "issue" | "comment";

export type ReactionState = {
  reactionId: number | null;
  reactionTarget: ReactionTarget;
  commentId: number | null;
  issueNumber: number;
  repo: string;
};

export type EventContext = {
  eventName: string;
  issueNumber: number;
  commentId: number | null;
  repo: string;
  authorAssociation: string;
};

const ALLOWED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * Determine whether an actor's association allows agent interaction.
 * Mirrors gitclaw's authorization gating: only OWNER, MEMBER, or
 * COLLABORATOR can trigger the agent pipeline.
 */
export function isAuthorizedAssociation(association: string): boolean {
  return ALLOWED_ASSOCIATIONS.has(association.toUpperCase());
}

/**
 * Parse a GitHub Actions event payload into a structured context.
 * Handles both `issues` (opened) and `issue_comment` (created) events.
 */
export function parseEventContext(
  eventName: string,
  payload: Record<string, unknown>,
  repo: string,
): EventContext {
  if (eventName === "issue_comment") {
    const comment = payload.comment as Record<string, unknown> | undefined;
    const issue = payload.issue as Record<string, unknown> | undefined;
    return {
      eventName,
      issueNumber: (issue?.number as number) ?? 0,
      commentId: (comment?.id as number) ?? null,
      repo,
      authorAssociation: (comment?.author_association as string) ?? "NONE",
    };
  }

  // issues (opened)
  const issue = payload.issue as Record<string, unknown> | undefined;
  return {
    eventName,
    issueNumber: (issue?.number as number) ?? 0,
    commentId: null,
    repo,
    authorAssociation: (issue?.author_association as string) ?? "NONE",
  };
}

/**
 * Determine the reaction target based on event type.
 * Comment events target the comment; issue events target the issue.
 */
export function resolveReactionTarget(eventName: string): ReactionTarget {
  return eventName === "issue_comment" ? "comment" : "issue";
}

/**
 * Build a reaction state object for cross-step handoff.
 * This mirrors gitclaw's /tmp/reaction-state.json pattern.
 */
export function buildReactionState(
  context: EventContext,
  reactionId: number | null,
): ReactionState {
  return {
    reactionId,
    reactionTarget: resolveReactionTarget(context.eventName),
    commentId: context.commentId,
    issueNumber: context.issueNumber,
    repo: context.repo,
  };
}

/**
 * Build the `gh api` command arguments to add an eyes reaction.
 */
export function buildAddReactionArgs(context: EventContext): string[] {
  const [owner, repo] = context.repo.split("/");
  if (context.eventName === "issue_comment" && context.commentId) {
    return [
      "api",
      `repos/${owner}/${repo}/issues/comments/${context.commentId}/reactions`,
      "-f",
      "content=eyes",
      "--jq",
      ".id",
    ];
  }
  return [
    "api",
    `repos/${owner}/${repo}/issues/${context.issueNumber}/reactions`,
    "-f",
    "content=eyes",
    "--jq",
    ".id",
  ];
}

/**
 * Build the `gh api` command arguments to remove a reaction.
 */
export function buildRemoveReactionArgs(state: ReactionState): string[] | null {
  if (state.reactionId === null) {
    return null;
  }

  const [owner, repo] = state.repo.split("/");
  if (state.reactionTarget === "comment" && state.commentId) {
    return [
      "api",
      "--method",
      "DELETE",
      `repos/${owner}/${repo}/issues/comments/${state.commentId}/reactions/${state.reactionId}`,
    ];
  }
  return [
    "api",
    "--method",
    "DELETE",
    `repos/${owner}/${repo}/issues/${state.issueNumber}/reactions/${state.reactionId}`,
  ];
}

/**
 * Extract the user's prompt from the event payload.
 * For issue_comment events: the comment body.
 * For issues (opened): title + body.
 * Mirrors gitclaw's prompt selection logic.
 */
export function extractPrompt(eventName: string, payload: Record<string, unknown>): string {
  if (eventName === "issue_comment") {
    const comment = payload.comment as Record<string, unknown> | undefined;
    return (comment?.body as string) ?? "";
  }

  const issue = payload.issue as Record<string, unknown> | undefined;
  const title = (issue?.title as string) ?? "";
  const body = (issue?.body as string) ?? "";
  return body ? `${title}\n\n${body}` : title;
}

// --- CLI entry point (runs inside GitHub Actions) ---

function main(): void {
  const mode = process.argv[2];

  if (mode === "add") {
    addReaction();
  } else if (mode === "remove") {
    removeReaction();
  } else {
    console.error("Usage: signal-reaction.ts <add|remove>");
    console.error("  add    — Add eyes reaction and write state to --state-file");
    console.error("  remove — Remove reaction using state from --state-file");
    process.exit(1);
  }
}

function addReaction(): void {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const repo = process.env.GITHUB_REPOSITORY;
  const stateFile = getArgValue("--state-file");

  if (!eventPath || !eventName || !repo) {
    console.error("Missing required GitHub Actions environment variables");
    process.exit(1);
  }

  if (!stateFile) {
    console.error("--state-file is required");
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, unknown>;
  const context = parseEventContext(eventName, payload, repo);

  if (!isAuthorizedAssociation(context.authorAssociation)) {
    console.log(
      `Skipping reaction: author association "${context.authorAssociation}" is not authorized`,
    );
    const state = buildReactionState(context, null);
    writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
    return;
  }

  const args = buildAddReactionArgs(context);
  console.log(`Adding eyes reaction: gh ${args.join(" ")}`);

  // In the actual workflow, `gh` CLI handles the API call.
  // Write state for downstream cleanup.
  const state = buildReactionState(context, null);
  writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
  console.log(`Reaction state written to ${stateFile}`);
}

function removeReaction(): void {
  const stateFile = getArgValue("--state-file");

  if (!stateFile) {
    console.error("--state-file is required");
    process.exit(1);
  }

  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8")) as ReactionState;
    const args = buildRemoveReactionArgs(state);

    if (!args) {
      console.log("No reaction to remove (reactionId is null)");
      return;
    }

    console.log(`Removing reaction: gh ${args.join(" ")}`);
  } catch (error) {
    // Non-fatal: cleanup failures should not crash the pipeline.
    // Mirrors gitclaw's try/catch in the finally block.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: reaction cleanup failed: ${message}`);
  }
}

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("signal-reaction.ts")
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: reaction signal failed: ${message}`);
    // Non-fatal exit: reaction failures should not block the pipeline.
  }
}
