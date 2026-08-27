import { openTestDb } from "../testing/test-db";
import {
  recordIssueClaimed,
  recordIssueUnclaimed,
  recordPullRequestOpened,
  recordReviewSubmitted,
  recordPullRequestClosed,
  findStaleClaims,
  findStalePullRequests,
  recordNudgeSent,
} from "../funnel/funnel-state";

const REPO = "acme/widgets";

describe("funnel-state", () => {
  it("tracks a claimed issue and finds it once it goes stale", () => {
    const db = openTestDb();
    const claimedAt = Date.now() - 20 * 24 * 60 * 60 * 1000; // 20 days ago

    recordIssueClaimed(db, { repoFullName: REPO, number: 1, claimedBy: "alice", now: claimedAt });

    const stale = findStaleClaims(db, {
      repoFullName: REPO,
      olderThan: Date.now() - 14 * 24 * 60 * 60 * 1000,
      maxNudges: 2,
    });

    expect(stale).toHaveLength(1);
    expect(stale[0].claimedBy).toBe("alice");
  });

  it("does not flag a claim newer than the threshold", () => {
    const db = openTestDb();
    recordIssueClaimed(db, { repoFullName: REPO, number: 1, claimedBy: "alice", now: Date.now() });

    const stale = findStaleClaims(db, {
      repoFullName: REPO,
      olderThan: Date.now() - 14 * 24 * 60 * 60 * 1000,
      maxNudges: 2,
    });

    expect(stale).toHaveLength(0);
  });

  it("stops tracking an issue once it's unassigned", () => {
    const db = openTestDb();
    const claimedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    recordIssueClaimed(db, { repoFullName: REPO, number: 1, claimedBy: "alice", now: claimedAt });

    recordIssueUnclaimed(db, { repoFullName: REPO, number: 1 });

    const stale = findStaleClaims(db, {
      repoFullName: REPO,
      olderThan: Date.now() - 14 * 24 * 60 * 60 * 1000,
      maxNudges: 2,
    });
    expect(stale).toHaveLength(0);
  });

  it("moves a claimed issue out of the stale-claim pool once a PR links it", () => {
    const db = openTestDb();
    const claimedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    recordIssueClaimed(db, { repoFullName: REPO, number: 1, claimedBy: "alice", now: claimedAt });

    recordPullRequestOpened(db, {
      repoFullName: REPO,
      number: 2,
      linkedIssueNumber: 1,
      now: Date.now(),
    });

    const staleClaims = findStaleClaims(db, {
      repoFullName: REPO,
      olderThan: Date.now() - 14 * 24 * 60 * 60 * 1000,
      maxNudges: 2,
    });
    expect(staleClaims).toHaveLength(0);
  });

  it("finds a PR that's been open too long with no review", () => {
    const db = openTestDb();
    const openedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    recordPullRequestOpened(db, { repoFullName: REPO, number: 5, now: openedAt });

    const stale = findStalePullRequests(db, {
      repoFullName: REPO,
      olderThan: Date.now() - 7 * 24 * 60 * 60 * 1000,
      maxNudges: 2,
    });

    expect(stale).toHaveLength(1);
    expect(stale[0].number).toBe(5);
  });

  it("clears staleness once a review is submitted", () => {
    const db = openTestDb();
    const openedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    recordPullRequestOpened(db, { repoFullName: REPO, number: 5, now: openedAt });

    recordReviewSubmitted(db, { repoFullName: REPO, number: 5, now: Date.now() });

    const stale = findStalePullRequests(db, {
      repoFullName: REPO,
      olderThan: Date.now() - 7 * 24 * 60 * 60 * 1000,
      maxNudges: 2,
    });
    expect(stale).toHaveLength(0);
  });

  it("respects the max-nudges cap so a stuck item isn't pinged forever", () => {
    const db = openTestDb();
    const claimedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    recordIssueClaimed(db, { repoFullName: REPO, number: 1, claimedBy: "alice", now: claimedAt });

    recordNudgeSent(db, { repoFullName: REPO, number: 1, now: Date.now() });
    recordNudgeSent(db, { repoFullName: REPO, number: 1, now: Date.now() });

    const stale = findStaleClaims(db, {
      repoFullName: REPO,
      olderThan: Date.now() - 14 * 24 * 60 * 60 * 1000,
      maxNudges: 2,
    });
    expect(stale).toHaveLength(0);
  });

  it("carries a merged PR's status back onto its linked issue", () => {
    const db = openTestDb();
    const claimedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    recordIssueClaimed(db, { repoFullName: REPO, number: 1, claimedBy: "alice", now: claimedAt });
    recordPullRequestOpened(db, {
      repoFullName: REPO,
      number: 2,
      linkedIssueNumber: 1,
      now: Date.now(),
    });

    recordPullRequestClosed(db, { repoFullName: REPO, number: 2, merged: true, now: Date.now() });

    const staleClaims = findStaleClaims(db, {
      repoFullName: REPO,
      olderThan: 0,
      maxNudges: 99,
    });
    expect(staleClaims).toHaveLength(0);
  });
});
