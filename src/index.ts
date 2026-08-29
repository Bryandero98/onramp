import type { Probot, Context, Logger } from "probot";

import { openDb, type Db } from "./database/db";
import { loadConfig, type ConfigClient } from "./config/onramp-config";
import {
  recordIssueClaimed,
  recordIssueUnclaimed,
  recordPullRequestOpened,
  recordReviewSubmitted,
  recordPullRequestClosed,
} from "./funnel/funnel-state";
import { parseLinkedIssueNumber } from "./funnel/linked-issue";
import { runFunnelSweep, type NudgeClient } from "./nudge/sweep";

const FIRST_TIME_ASSOCIATIONS = new Set(["FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER"]);
const SWEEP_INTERVAL_MS = Number(process.env.ONRAMP_SWEEP_INTERVAL_MS ?? 60 * 60 * 1000);
const DB_PATH = process.env.ONRAMP_DB_PATH ?? "onramp.db";

/** Whatever Probot's `app.onError` hands its callback - one real webhook delivery's errors. */
export type WebhookErrorEvent = Parameters<Probot["onError"]>[0] extends (
  event: infer E,
) => unknown
  ? E
  : never;

// Centralized, not per-handler: every `app.on(...)` below throws straight
// through on failure rather than catching locally, and this is the one
// place that turns whatever comes out (a DB error, a GitHub API error) into
// a structured log line with the delivery id, event name, and repo -
// instead of 5 near-identical try/catch blocks, one per handler, that would
// drift out of sync with each other over time. A named, exported function
// instead of an inline closure so it's unit-testable against a
// hand-built event, not only reachable end-to-end through a real Probot
// instance.
export function logWebhookError(log: Logger, errorEvent: WebhookErrorEvent): void {
  const payload = errorEvent.event.payload;
  const repo =
    "repository" in payload
      ? (payload as { repository?: { full_name?: string } }).repository?.full_name
      : undefined;

  for (const error of errorEvent) {
    log.error(
      { err: error, deliveryId: errorEvent.event.id, webhookEvent: errorEvent.event.name, repo },
      "webhook handler failed",
    );
  }
}

export default (app: Probot) => {
  const db = openDb(DB_PATH);

  app.onError((errorEvent) => logWebhookError(app.log, errorEvent));

  app.on("issues.assigned", async (context: Context<"issues.assigned">) => {
    const assignee = context.payload.assignee;
    if (!assignee) return;

    recordIssueClaimed(db, {
      repoFullName: context.payload.repository.full_name,
      number: context.payload.issue.number,
      claimedBy: assignee.login,
      now: Date.now(),
    });
  });

  app.on("issues.unassigned", async (context: Context<"issues.unassigned">) => {
    recordIssueUnclaimed(db, {
      repoFullName: context.payload.repository.full_name,
      number: context.payload.issue.number,
    });
  });

  app.on("pull_request.opened", async (context: Context<"pull_request.opened">) => {
    const pr = context.payload.pull_request;
    const repoFullName = context.payload.repository.full_name;
    const now = Date.now();

    recordPullRequestOpened(db, {
      repoFullName,
      number: pr.number,
      linkedIssueNumber: parseLinkedIssueNumber(pr.body),
      now,
    });

    const config = await loadConfig(context.octokit, context.repo());
    if (config.welcomeFirstTimeContributors && FIRST_TIME_ASSOCIATIONS.has(pr.author_association)) {
      await context.octokit.issues.createComment(
        context.issue({
          body:
            `Welcome, and thanks for the pull request! 🎉 A maintainer will take a look soon. ` +
            `In the meantime, feel free to ping this thread if anything's unclear about the review process.\n\n` +
            `_This is an automated welcome from [onramp](https://github.com/Bryandero98/onramp)._`,
        }),
      );
    }
  });

  app.on(
    "pull_request_review.submitted",
    async (context: Context<"pull_request_review.submitted">) => {
      recordReviewSubmitted(db, {
        repoFullName: context.payload.repository.full_name,
        number: context.payload.pull_request.number,
        now: Date.now(),
      });
    },
  );

  app.on("pull_request.closed", async (context: Context<"pull_request.closed">) => {
    recordPullRequestClosed(db, {
      repoFullName: context.payload.repository.full_name,
      number: context.payload.pull_request.number,
      merged: context.payload.pull_request.merged,
      now: Date.now(),
    });
  });

  if (SWEEP_INTERVAL_MS > 0) {
    const schedulerState: SweepSchedulerState = { running: false };
    setInterval(() => {
      void tickSweep(schedulerState, () => runInstallationSweeps(app, db), app.log);
    }, SWEEP_INTERVAL_MS);
  }
};

export interface SweepSchedulerState {
  running: boolean;
}

/**
 * One tick of the sweep scheduler: runs `sweep()` unless a previous tick's
 * sweep is still in flight, in which case this tick is skipped and logged
 * rather than run concurrently with it.
 *
 * A sweep is one HTTP call per installation plus one per repo it can see -
 * for an app installed on a large org, that can run long enough to still be
 * going when the next tick fires. Without this guard, two overlapping
 * sweeps would both read the same stale items, both post a nudge for them,
 * and both increment nudgeCount - doubling every nudge an installation with
 * a lot of repos gets, right at the moment it has the least slack to
 * absorb noisy comments.
 *
 * Extracted out of the setInterval callback (rather than inlined in the
 * default export above) so the guard itself has a direct test instead of
 * relying on code review to catch a race in it.
 */
export async function tickSweep(
  state: SweepSchedulerState,
  sweep: () => Promise<void>,
  log: Logger,
): Promise<void> {
  if (state.running) {
    log.warn("skipping sweep tick - previous sweep is still running");
    return;
  }
  state.running = true;
  try {
    await sweep();
  } catch (error) {
    log.error(error, "installation sweep failed");
  } finally {
    state.running = false;
  }
}

/** The slice of an installation-scoped Octokit that a sweep needs. */
export interface SweepOctokit {
  paginate: <T>(fn: unknown, params?: unknown) => Promise<T[]>;
  apps: { listReposAccessibleToInstallation: unknown };
  issues: {
    createComment(args: {
      owner: string;
      repo: string;
      issue_number: number;
      body: string;
    }): Promise<unknown>;
  };
  repos: ConfigClient["repos"];
}

interface AccessibleRepo {
  full_name: string;
  name: string;
  owner: { login: string };
}

export interface SweepSummary {
  reposSwept: number;
  reposFailed: number;
  nudgesSent: number;
}

/**
 * Sweeps every repo one installation's Octokit client can see. Kept separate
 * from `runInstallationSweeps` below so it's unit-testable against a fake
 * `SweepOctokit` instead of a real, app-authenticated one.
 *
 * One repo's failure (a malformed `.github/onramp.yml`, a transient GitHub
 * API error) never aborts the rest of the loop - an installation with 50
 * repos shouldn't go completely un-swept because the 3rd one has a bad
 * config file. Failures are counted and, if a logger is given, logged with
 * which repo failed; the sweep otherwise proceeds normally.
 */
export async function sweepRepos(
  octokit: SweepOctokit,
  db: Db,
  now: number,
  log?: Logger,
): Promise<SweepSummary> {
  const repos = await octokit.paginate<AccessibleRepo>(
    octokit.apps.listReposAccessibleToInstallation,
  );

  const client: NudgeClient = {
    async postComment({ owner, repo, issueNumber, body }) {
      await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    },
  };

  const summary: SweepSummary = { reposSwept: 0, reposFailed: 0, nudgesSent: 0 };

  for (const repo of repos) {
    try {
      const config = await loadConfig(octokit, { owner: repo.owner.login, repo: repo.name });
      const { nudged } = await runFunnelSweep({
        db,
        client,
        repoFullName: repo.full_name,
        config,
        now,
      });
      summary.reposSwept++;
      summary.nudgesSent += nudged.length;
    } catch (error) {
      summary.reposFailed++;
      log?.error({ err: error, repo: repo.full_name }, "sweep failed for repo, skipping it");
    }
  }

  return summary;
}

/**
 * Cross-repo cron: iterates every installation onramp is on and sweeps each
 * one's repos. Probot has no built-in scheduler, so this is the documented
 * pattern - app.auth() with no id gets the app-level client used to list
 * installations, app.auth(id) gets a client scoped to each one.
 *
 * Same fault-isolation reasoning as sweepRepos, one level up: one
 * installation failing to authenticate shouldn't skip every installation
 * after it in the list. Logs one summary line per run so "is the sweep
 * actually doing anything" is answerable from the logs, not just from
 * poking the database.
 */
async function runInstallationSweeps(app: Probot, db: Db): Promise<void> {
  const appOctokit = await app.auth();
  const installations = await appOctokit.paginate(appOctokit.apps.listInstallations);

  const totals = { installationsSwept: 0, installationsFailed: 0, reposSwept: 0, reposFailed: 0, nudgesSent: 0 };
  const now = Date.now();

  for (const installation of installations) {
    try {
      const octokit = await app.auth(installation.id);
      const summary = await sweepRepos(octokit as unknown as SweepOctokit, db, now, app.log);
      totals.installationsSwept++;
      totals.reposSwept += summary.reposSwept;
      totals.reposFailed += summary.reposFailed;
      totals.nudgesSent += summary.nudgesSent;
    } catch (error) {
      totals.installationsFailed++;
      app.log.error(
        { err: error, installationId: installation.id },
        "sweep failed for installation, skipping it",
      );
    }
  }

  app.log.info(totals, "installation sweep complete");
}
