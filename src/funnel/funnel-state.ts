import { and, eq, lt, sql } from "drizzle-orm";

import type { Db } from "../database/db";
import { funnelItems } from "../database/schema";

export type FunnelStage = "claimed" | "pr_opened" | "in_review" | "merged" | "abandoned";

interface RepoItem {
  repoFullName: string;
  number: number;
}

/** An issue was assigned to someone: start tracking it as "claimed". */
export function recordIssueClaimed(
  db: Db,
  args: RepoItem & { claimedBy: string; now: number },
): void {
  db.insert(funnelItems)
    .values({
      repoFullName: args.repoFullName,
      number: args.number,
      kind: "issue",
      stage: "claimed",
      claimedBy: args.claimedBy,
      claimedAt: args.now,
      lastActivityAt: args.now,
      nudgeCount: 0,
    })
    .onConflictDoUpdate({
      target: [funnelItems.repoFullName, funnelItems.number],
      set: {
        stage: "claimed",
        claimedBy: args.claimedBy,
        claimedAt: args.now,
        lastActivityAt: args.now,
        nudgeCount: 0,
        lastNudgedAt: null,
      },
    })
    .run();
}

/** An issue was unassigned before a PR showed up: stop tracking it. */
export function recordIssueUnclaimed(db: Db, args: RepoItem): void {
  db.delete(funnelItems)
    .where(
      and(
        eq(funnelItems.repoFullName, args.repoFullName),
        eq(funnelItems.number, args.number),
        eq(funnelItems.kind, "issue"),
      ),
    )
    .run();
}

/** A PR was opened, optionally closing out the issue it claims to fix. */
export function recordPullRequestOpened(
  db: Db,
  args: RepoItem & { linkedIssueNumber?: number; now: number },
): void {
  db.insert(funnelItems)
    .values({
      repoFullName: args.repoFullName,
      number: args.number,
      kind: "pull_request",
      stage: "pr_opened",
      linkedIssueNumber: args.linkedIssueNumber,
      lastActivityAt: args.now,
      nudgeCount: 0,
    })
    .onConflictDoUpdate({
      target: [funnelItems.repoFullName, funnelItems.number],
      set: { stage: "pr_opened", lastActivityAt: args.now, nudgeCount: 0, lastNudgedAt: null },
    })
    .run();

  if (args.linkedIssueNumber !== undefined) {
    db.update(funnelItems)
      .set({ stage: "pr_opened", lastActivityAt: args.now })
      .where(
        and(
          eq(funnelItems.repoFullName, args.repoFullName),
          eq(funnelItems.number, args.linkedIssueNumber),
          eq(funnelItems.kind, "issue"),
        ),
      )
      .run();
  }
}

/** A review (of any kind) landed on a PR: it's no longer waiting silently. */
export function recordReviewSubmitted(db: Db, args: RepoItem & { now: number }): void {
  db.update(funnelItems)
    .set({ stage: "in_review", lastActivityAt: args.now, nudgeCount: 0, lastNudgedAt: null })
    .where(
      and(
        eq(funnelItems.repoFullName, args.repoFullName),
        eq(funnelItems.number, args.number),
        eq(funnelItems.kind, "pull_request"),
      ),
    )
    .run();
}

/** A PR closed, merged or not: stop nudging about it either way. */
export function recordPullRequestClosed(
  db: Db,
  args: RepoItem & { merged: boolean; now: number },
): void {
  const stage: FunnelStage = args.merged ? "merged" : "abandoned";

  db.update(funnelItems)
    .set({ stage, lastActivityAt: args.now })
    .where(
      and(
        eq(funnelItems.repoFullName, args.repoFullName),
        eq(funnelItems.number, args.number),
        eq(funnelItems.kind, "pull_request"),
      ),
    )
    .run();

  const [item] = db
    .select({ linkedIssueNumber: funnelItems.linkedIssueNumber })
    .from(funnelItems)
    .where(
      and(eq(funnelItems.repoFullName, args.repoFullName), eq(funnelItems.number, args.number)),
    )
    .all();

  if (item?.linkedIssueNumber !== undefined && item?.linkedIssueNumber !== null && args.merged) {
    db.update(funnelItems)
      .set({ stage: "merged", lastActivityAt: args.now })
      .where(
        and(
          eq(funnelItems.repoFullName, args.repoFullName),
          eq(funnelItems.number, item.linkedIssueNumber),
          eq(funnelItems.kind, "issue"),
        ),
      )
      .run();
  }
}

export interface StaleItem {
  repoFullName: string;
  number: number;
  kind: "issue" | "pull_request";
  claimedBy: string | null;
  lastActivityAt: number;
  nudgeCount: number;
}

/** Issues claimed (assigned) long enough ago with no follow-up activity. */
export function findStaleClaims(
  db: Db,
  args: { repoFullName: string; olderThan: number; maxNudges: number },
): StaleItem[] {
  return db
    .select({
      repoFullName: funnelItems.repoFullName,
      number: funnelItems.number,
      kind: funnelItems.kind,
      claimedBy: funnelItems.claimedBy,
      lastActivityAt: funnelItems.lastActivityAt,
      nudgeCount: funnelItems.nudgeCount,
    })
    .from(funnelItems)
    .where(
      and(
        eq(funnelItems.repoFullName, args.repoFullName),
        eq(funnelItems.stage, "claimed"),
        lt(funnelItems.lastActivityAt, args.olderThan),
        lt(funnelItems.nudgeCount, args.maxNudges),
      ),
    )
    .all();
}

/** PRs opened long enough ago with no review activity since. */
export function findStalePullRequests(
  db: Db,
  args: { repoFullName: string; olderThan: number; maxNudges: number },
): StaleItem[] {
  return db
    .select({
      repoFullName: funnelItems.repoFullName,
      number: funnelItems.number,
      kind: funnelItems.kind,
      claimedBy: funnelItems.claimedBy,
      lastActivityAt: funnelItems.lastActivityAt,
      nudgeCount: funnelItems.nudgeCount,
    })
    .from(funnelItems)
    .where(
      and(
        eq(funnelItems.repoFullName, args.repoFullName),
        eq(funnelItems.stage, "pr_opened"),
        lt(funnelItems.lastActivityAt, args.olderThan),
        lt(funnelItems.nudgeCount, args.maxNudges),
      ),
    )
    .all();
}

export function recordNudgeSent(db: Db, args: RepoItem & { now: number }): void {
  db.update(funnelItems)
    .set({
      nudgeCount: sql`${funnelItems.nudgeCount} + 1`,
      lastNudgedAt: args.now,
    })
    .where(
      and(eq(funnelItems.repoFullName, args.repoFullName), eq(funnelItems.number, args.number)),
    )
    .run();
}
