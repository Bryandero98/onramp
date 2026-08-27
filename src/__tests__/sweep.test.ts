import { openTestDb } from "../testing/test-db";
import { recordIssueClaimed, recordPullRequestOpened } from "../funnel/funnel-state";
import { runFunnelSweep, type NudgeClient } from "../nudge/sweep";
import { DEFAULT_CONFIG } from "../config/onramp-config";

const REPO = "acme/widgets";

describe("runFunnelSweep", () => {
  it("nudges a stale claim exactly once per sweep and records it", async () => {
    const db = openTestDb();
    const claimedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    recordIssueClaimed(db, { repoFullName: REPO, number: 1, claimedBy: "alice", now: claimedAt });

    const posted: { issueNumber: number; body: string }[] = [];
    const client: NudgeClient = {
      async postComment({ issueNumber, body }) {
        posted.push({ issueNumber, body });
      },
    };

    const { nudged } = await runFunnelSweep({
      db,
      client,
      repoFullName: REPO,
      config: DEFAULT_CONFIG,
      now: Date.now(),
    });

    expect(nudged).toHaveLength(1);
    expect(posted).toHaveLength(1);
    expect(posted[0].issueNumber).toBe(1);
    expect(posted[0].body).toContain("@alice");
  });

  it("does not nudge twice in the same sweep for the same repo pass", async () => {
    const db = openTestDb();
    const openedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    recordPullRequestOpened(db, { repoFullName: REPO, number: 9, now: openedAt });

    let calls = 0;
    const client: NudgeClient = {
      async postComment() {
        calls += 1;
      },
    };

    await runFunnelSweep({
      db,
      client,
      repoFullName: REPO,
      config: DEFAULT_CONFIG,
      now: Date.now(),
    });
    await runFunnelSweep({
      db,
      client,
      repoFullName: REPO,
      config: DEFAULT_CONFIG,
      now: Date.now(),
    });

    // maxNudges defaults to 2, so a second sweep with no new activity nudges again (1 -> 2)...
    expect(calls).toBe(2);

    // ...but a third sweep hits the cap and stops.
    await runFunnelSweep({
      db,
      client,
      repoFullName: REPO,
      config: DEFAULT_CONFIG,
      now: Date.now(),
    });
    expect(calls).toBe(2);
  });
});
