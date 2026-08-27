import type { Db } from "../database/db";
import type { OnrampConfig } from "../config/onramp-config";
import {
  findStaleClaims,
  findStalePullRequests,
  recordNudgeSent,
  type StaleItem,
} from "../funnel/funnel-state";
import { staleClaimMessage, stalePullRequestMessage } from "./nudge-messages";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The one octokit call the sweep needs - kept minimal so it's trivial to fake in tests. */
export interface NudgeClient {
  postComment(args: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<void>;
}

interface SweepArgs {
  db: Db;
  client: NudgeClient;
  repoFullName: string;
  config: OnrampConfig;
  now: number;
}

/**
 * Runs one pass over a repo's tracked funnel items, nudging anything stale.
 * Called on a schedule per installation - see src/index.ts.
 */
export async function runFunnelSweep(args: SweepArgs): Promise<{ nudged: StaleItem[] }> {
  const { db, client, repoFullName, config, now } = args;
  const [owner, repo] = repoFullName.split("/");
  const nudged: StaleItem[] = [];

  const staleClaims = findStaleClaims(db, {
    repoFullName,
    olderThan: now - config.staleClaimDays * DAY_MS,
    maxNudges: config.maxNudges,
  });

  for (const item of staleClaims) {
    await client.postComment({
      owner,
      repo,
      issueNumber: item.number,
      body: staleClaimMessage(item, now),
    });
    recordNudgeSent(db, { repoFullName, number: item.number, now });
    nudged.push(item);
  }

  const stalePullRequests = findStalePullRequests(db, {
    repoFullName,
    olderThan: now - config.staleReviewDays * DAY_MS,
    maxNudges: config.maxNudges,
  });

  for (const item of stalePullRequests) {
    await client.postComment({
      owner,
      repo,
      issueNumber: item.number,
      body: stalePullRequestMessage(item, now),
    });
    recordNudgeSent(db, { repoFullName, number: item.number, now });
    nudged.push(item);
  }

  return { nudged };
}
