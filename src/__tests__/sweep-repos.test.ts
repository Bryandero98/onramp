import { openTestDb } from "../testing/test-db";
import { recordIssueClaimed } from "../funnel/funnel-state";
import { sweepRepos, type SweepOctokit } from "../index";

const REPO = { full_name: "acme/widgets", name: "widgets", owner: { login: "acme" } };

function fakeInstallationOctokit(args: {
  repos: (typeof REPO)[];
  onComment: (args: { owner: string; repo: string; issue_number: number; body: string }) => void;
}): SweepOctokit {
  return {
    // This fake is only ever asked to paginate one thing (the repo list),
    // so it doesn't need to inspect which function it was handed.
    async paginate<T>(): Promise<T[]> {
      return args.repos as unknown as T[];
    },
    apps: {
      listReposAccessibleToInstallation: Symbol("listReposAccessibleToInstallation"),
    },
    issues: {
      async createComment(commentArgs) {
        args.onComment(commentArgs);
      },
    },
    repos: {
      async getContent() {
        const notFound = Object.assign(new Error("Not Found"), { status: 404 });
        throw notFound;
      },
    },
  };
}

describe("sweepRepos", () => {
  it("nudges a stale claim in every repo the installation can see", async () => {
    const db = openTestDb();
    const claimedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    recordIssueClaimed(db, {
      repoFullName: REPO.full_name,
      number: 1,
      claimedBy: "alice",
      now: claimedAt,
    });

    const posted: { issue_number: number; body: string }[] = [];
    const octokit = fakeInstallationOctokit({ repos: [REPO], onComment: (c) => posted.push(c) });

    await sweepRepos(octokit, db, Date.now());

    expect(posted).toHaveLength(1);
    expect(posted[0].issue_number).toBe(1);
    expect(posted[0].body).toContain("@alice");
  });

  it("does nothing when the installation has no stale items", async () => {
    const db = openTestDb();
    recordIssueClaimed(db, {
      repoFullName: REPO.full_name,
      number: 1,
      claimedBy: "alice",
      now: Date.now(),
    });

    const posted: unknown[] = [];
    const octokit = fakeInstallationOctokit({ repos: [REPO], onComment: (c) => posted.push(c) });

    await sweepRepos(octokit, db, Date.now());

    expect(posted).toHaveLength(0);
  });

  it("sweeps every accessible repo independently", async () => {
    const otherRepo = { full_name: "acme/other", name: "other", owner: { login: "acme" } };
    const db = openTestDb();
    const claimedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    recordIssueClaimed(db, {
      repoFullName: REPO.full_name,
      number: 1,
      claimedBy: "alice",
      now: claimedAt,
    });
    recordIssueClaimed(db, {
      repoFullName: otherRepo.full_name,
      number: 2,
      claimedBy: "bob",
      now: claimedAt,
    });

    const posted: { owner: string; repo: string }[] = [];
    const octokit = fakeInstallationOctokit({
      repos: [REPO, otherRepo],
      onComment: (c) => posted.push({ owner: c.owner, repo: c.repo }),
    });

    await sweepRepos(octokit, db, Date.now());

    expect(posted).toHaveLength(2);
    expect(posted).toContainEqual({ owner: "acme", repo: "widgets" });
    expect(posted).toContainEqual({ owner: "acme", repo: "other" });
  });
});
