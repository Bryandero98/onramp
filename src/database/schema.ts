import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * One row per (repo, issue/PR number) tracked through the contributor funnel.
 * `number` refers to the GitHub issue or pull request number - GitHub shares
 * one numbering sequence per repo across both, so a claimed issue and the PR
 * that eventually closes it are linked by number via `linkedIssueNumber`.
 */
export const funnelItems = sqliteTable(
  "funnel_items",
  {
    repoFullName: text("repo_full_name").notNull(),
    number: integer("number").notNull(),
    kind: text("kind", { enum: ["issue", "pull_request"] }).notNull(),
    stage: text("stage", {
      enum: ["claimed", "pr_opened", "in_review", "merged", "abandoned"],
    }).notNull(),
    claimedBy: text("claimed_by"),
    claimedAt: integer("claimed_at"),
    linkedIssueNumber: integer("linked_issue_number"),
    lastActivityAt: integer("last_activity_at").notNull(),
    nudgeCount: integer("nudge_count").notNull().default(0),
    lastNudgedAt: integer("last_nudged_at"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.repoFullName, table.number] }),
  }),
);
