import { describe, expect, it } from "vitest";
import {
  buildAddReactionArgs,
  buildReactionState,
  buildRemoveReactionArgs,
  extractPrompt,
  isAuthorizedAssociation,
  parseEventContext,
  resolveReactionTarget,
} from "../scripts/signal-reaction.js";

describe("signal-reaction", () => {
  describe("isAuthorizedAssociation", () => {
    it("allows OWNER", () => {
      expect(isAuthorizedAssociation("OWNER")).toBe(true);
    });

    it("allows MEMBER", () => {
      expect(isAuthorizedAssociation("MEMBER")).toBe(true);
    });

    it("allows COLLABORATOR", () => {
      expect(isAuthorizedAssociation("COLLABORATOR")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(isAuthorizedAssociation("owner")).toBe(true);
      expect(isAuthorizedAssociation("Member")).toBe(true);
    });

    it("rejects NONE", () => {
      expect(isAuthorizedAssociation("NONE")).toBe(false);
    });

    it("rejects CONTRIBUTOR", () => {
      expect(isAuthorizedAssociation("CONTRIBUTOR")).toBe(false);
    });

    it("rejects FIRST_TIME_CONTRIBUTOR", () => {
      expect(isAuthorizedAssociation("FIRST_TIME_CONTRIBUTOR")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isAuthorizedAssociation("")).toBe(false);
    });
  });

  describe("parseEventContext", () => {
    it("parses issue_comment event", () => {
      const payload = {
        issue: { number: 42 },
        comment: { id: 100, body: "explain src/main.ts", author_association: "OWNER" },
      };
      const ctx = parseEventContext("issue_comment", payload, "org/repo");
      expect(ctx.eventName).toBe("issue_comment");
      expect(ctx.issueNumber).toBe(42);
      expect(ctx.commentId).toBe(100);
      expect(ctx.repo).toBe("org/repo");
      expect(ctx.authorAssociation).toBe("OWNER");
    });

    it("parses issues opened event", () => {
      const payload = {
        issue: {
          number: 7,
          title: "Test this file",
          body: "Please test src/utils.ts",
          author_association: "MEMBER",
        },
      };
      const ctx = parseEventContext("issues", payload, "org/repo");
      expect(ctx.eventName).toBe("issues");
      expect(ctx.issueNumber).toBe(7);
      expect(ctx.commentId).toBeNull();
      expect(ctx.authorAssociation).toBe("MEMBER");
    });

    it("handles missing comment gracefully", () => {
      const payload = { issue: { number: 1 } };
      const ctx = parseEventContext("issue_comment", payload, "org/repo");
      expect(ctx.commentId).toBeNull();
      expect(ctx.authorAssociation).toBe("NONE");
    });
  });

  describe("resolveReactionTarget", () => {
    it("returns comment for issue_comment events", () => {
      expect(resolveReactionTarget("issue_comment")).toBe("comment");
    });

    it("returns issue for issues events", () => {
      expect(resolveReactionTarget("issues")).toBe("issue");
    });
  });

  describe("buildReactionState", () => {
    it("builds correct state for comment events", () => {
      const ctx = {
        eventName: "issue_comment",
        issueNumber: 42,
        commentId: 100,
        repo: "org/repo",
        authorAssociation: "OWNER",
      };
      const state = buildReactionState(ctx, 999);
      expect(state.reactionId).toBe(999);
      expect(state.reactionTarget).toBe("comment");
      expect(state.commentId).toBe(100);
      expect(state.issueNumber).toBe(42);
      expect(state.repo).toBe("org/repo");
    });

    it("builds correct state for issue events", () => {
      const ctx = {
        eventName: "issues",
        issueNumber: 7,
        commentId: null,
        repo: "org/repo",
        authorAssociation: "MEMBER",
      };
      const state = buildReactionState(ctx, null);
      expect(state.reactionId).toBeNull();
      expect(state.reactionTarget).toBe("issue");
      expect(state.commentId).toBeNull();
    });
  });

  describe("buildAddReactionArgs", () => {
    it("builds comment reaction args for issue_comment", () => {
      const ctx = {
        eventName: "issue_comment",
        issueNumber: 42,
        commentId: 100,
        repo: "org/repo",
        authorAssociation: "OWNER",
      };
      const args = buildAddReactionArgs(ctx);
      expect(args).toContain("repos/org/repo/issues/comments/100/reactions");
      expect(args).toContain("content=eyes");
    });

    it("builds issue reaction args for issues event", () => {
      const ctx = {
        eventName: "issues",
        issueNumber: 7,
        commentId: null,
        repo: "org/repo",
        authorAssociation: "OWNER",
      };
      const args = buildAddReactionArgs(ctx);
      expect(args).toContain("repos/org/repo/issues/7/reactions");
      expect(args).toContain("content=eyes");
    });
  });

  describe("buildRemoveReactionArgs", () => {
    it("returns null when reactionId is null", () => {
      const state = {
        reactionId: null,
        reactionTarget: "issue" as const,
        commentId: null,
        issueNumber: 7,
        repo: "org/repo",
      };
      expect(buildRemoveReactionArgs(state)).toBeNull();
    });

    it("builds comment delete args for comment target", () => {
      const state = {
        reactionId: 999,
        reactionTarget: "comment" as const,
        commentId: 100,
        issueNumber: 42,
        repo: "org/repo",
      };
      const args = buildRemoveReactionArgs(state);
      expect(args).not.toBeNull();
      expect(args).toContain("DELETE");
      expect(args).toContain("repos/org/repo/issues/comments/100/reactions/999");
    });

    it("builds issue delete args for issue target", () => {
      const state = {
        reactionId: 888,
        reactionTarget: "issue" as const,
        commentId: null,
        issueNumber: 42,
        repo: "org/repo",
      };
      const args = buildRemoveReactionArgs(state);
      expect(args).not.toBeNull();
      expect(args).toContain("DELETE");
      expect(args).toContain("repos/org/repo/issues/42/reactions/888");
    });
  });

  describe("extractPrompt", () => {
    it("extracts comment body for issue_comment events", () => {
      const payload = {
        comment: { body: "/openclaw explain src/main.ts" },
        issue: { number: 1 },
      };
      expect(extractPrompt("issue_comment", payload)).toBe("/openclaw explain src/main.ts");
    });

    it("extracts title + body for issues events", () => {
      const payload = {
        issue: { title: "Refactor routing", body: "Please refactor the routing module" },
      };
      expect(extractPrompt("issues", payload)).toBe(
        "Refactor routing\n\nPlease refactor the routing module",
      );
    });

    it("returns title only when body is empty", () => {
      const payload = {
        issue: { title: "Quick test", body: "" },
      };
      expect(extractPrompt("issues", payload)).toBe("Quick test");
    });

    it("handles missing comment gracefully", () => {
      const payload = { issue: { number: 1 } };
      expect(extractPrompt("issue_comment", payload)).toBe("");
    });
  });
});
