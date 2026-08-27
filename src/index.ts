import type { Probot, Context } from "probot";

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

export default (app: Probot) => {
  const db = openDb(DB_PATH);

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
    setInterval(() => {
      runInstallationSweeps(app, db).catch((error) => app.log.error(error));
    }, SWEEP_INTERVAL_MS);
  }
};

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

/**
 * Sweeps every repo one installation's Octokit client can see. Kept separate
 * from `runInstallationSweeps` below so it's unit-testable against a fake
 * `SweepOctokit` instead of a real, app-authenticated one.
 */
export async function sweepRepos(octokit: SweepOctokit, db: Db, now: number): Promise<void> {
  const repos = await octokit.paginate<AccessibleRepo>(
    octokit.apps.listReposAccessibleToInstallation,
  );

  const client: NudgeClient = {
    async postComment({ owner, repo, issueNumber, body }) {
      await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    },
  };

  for (const repo of repos) {
    const config = await loadConfig(octokit, { owner: repo.owner.login, repo: repo.name });

    await runFunnelSweep({
      db,
      client,
      repoFullName: repo.full_name,
      config,
      now,
    });
  }
}

/**
 * Cross-repo cron: iterates every installation onramp is on and sweeps each
 * one's repos. Probot has no built-in scheduler, so this is the documented
 * pattern - app.auth() with no id gets the app-level client used to list
 * installations, app.auth(id) gets a client scoped to each one.
 */
async function runInstallationSweeps(app: Probot, db: Db): Promise<void> {
  const appOctokit = await app.auth();
  const installations = await appOctokit.paginate(appOctokit.apps.listInstallations);

  for (const installation of installations) {
    const octokit = await app.auth(installation.id);
    await sweepRepos(octokit as unknown as SweepOctokit, db, Date.now());
  }
}
