import { randomUUID } from "crypto";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { and, eq } from "drizzle-orm";
import nock from "nock";
import fetch from "node-fetch";
import { Probot, type ApplicationFunction } from "probot";

import { openDb, closeDb, type Db } from "../database/db";
import { funnelItems } from "../database/schema";

const REPO_FULL_NAME = "acme/widgets";
const REPO_PAYLOAD = { full_name: REPO_FULL_NAME, name: "widgets", owner: { login: "acme" } };
const CONFIG_PATH_PATTERN = /\/repos\/acme\/widgets\/contents\/.*onramp\.yml/;

/** Every test's PR is assumed to have no `.github/onramp.yml`, i.e. default config. */
function nockNoConfig() {
  nock("https://api.github.com").get(CONFIG_PATH_PATTERN).reply(404);
}

/**
 * Runs onramp's real webhook handlers end to end through a real Probot
 * instance. The only thing faked is the GitHub API itself (via nock) - the
 * database is a real, file-backed SQLite database so this helper can open a
 * second connection afterward and check exactly what got persisted.
 */
async function withApp(run: (probot: Probot, db: Db) => Promise<void>): Promise<void> {
  const dbPath = join(tmpdir(), `onramp-test-${randomUUID()}.db`);
  process.env.ONRAMP_DB_PATH = dbPath;
  process.env.ONRAMP_SWEEP_INTERVAL_MS = "0";
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appFn: ApplicationFunction = require("../index").default;

  const probot = new Probot({
    appId: 1,
    githubToken: "test",
    // nock's stable release only intercepts Node's http/https modules, not
    // the native fetch (undici) Octokit uses by default - swap in node-fetch,
    // which is http/https-based, so nock can see these requests in tests.
    request: { fetch: fetch as unknown as typeof globalThis.fetch },
  });
  await probot.load(appFn);

  const db = openDb(dbPath);
  try {
    await run(probot, db);
  } finally {
    closeDb(db);
    // The app's own internal connection (opened inside appFn, inaccessible
    // from here) may still hold the file open on Windows - best-effort only.
    try {
      if (existsSync(dbPath)) unlinkSync(dbPath);
    } catch {
      /* left for the OS to clean up */
    }
  }
}

function readItem(db: Db, number: number) {
  return db
    .select()
    .from(funnelItems)
    .where(and(eq(funnelItems.repoFullName, REPO_FULL_NAME), eq(funnelItems.number, number)))
    .all()[0];
}

beforeEach(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe("webhook handlers", () => {
  it("starts tracking an issue as claimed when it's assigned", async () => {
    await withApp(async (probot, db) => {
      await probot.receive({
        id: "1",
        name: "issues",
        payload: {
          action: "assigned",
          issue: { number: 1 },
          assignee: { login: "alice" },
          repository: REPO_PAYLOAD,
        } as never,
      });

      const item = readItem(db, 1);
      expect(item?.stage).toBe("claimed");
      expect(item?.claimedBy).toBe("alice");
    });
  });

  it("stops tracking an issue once it's unassigned", async () => {
    await withApp(async (probot, db) => {
      await probot.receive({
        id: "1",
        name: "issues",
        payload: {
          action: "assigned",
          issue: { number: 1 },
          assignee: { login: "alice" },
          repository: REPO_PAYLOAD,
        } as never,
      });
      await probot.receive({
        id: "2",
        name: "issues",
        payload: { action: "unassigned", issue: { number: 1 }, repository: REPO_PAYLOAD } as never,
      });

      expect(readItem(db, 1)).toBeUndefined();
    });
  });

  it("welcomes a first-time contributor's PR", async () => {
    nockNoConfig();
    const commentScope = nock("https://api.github.com")
      .post("/repos/acme/widgets/issues/3/comments", (body) => body.body.includes("Welcome"))
      .reply(201, {});

    await withApp(async (probot, db) => {
      await probot.receive({
        id: "1",
        name: "pull_request",
        payload: {
          action: "opened",
          repository: REPO_PAYLOAD,
          pull_request: {
            number: 3,
            body: "My first contribution!",
            author_association: "FIRST_TIME_CONTRIBUTOR",
          },
        } as never,
      });

      expect(readItem(db, 3)?.stage).toBe("pr_opened");
      expect(commentScope.isDone()).toBe(true);
    });
  });

  it("does not welcome a returning contributor", async () => {
    nockNoConfig();
    const commentScope = nock("https://api.github.com")
      .post("/repos/acme/widgets/issues/4/comments")
      .reply(201, {});

    await withApp(async (probot, db) => {
      await probot.receive({
        id: "1",
        name: "pull_request",
        payload: {
          action: "opened",
          repository: REPO_PAYLOAD,
          pull_request: { number: 4, body: null, author_association: "CONTRIBUTOR" },
        } as never,
      });

      expect(readItem(db, 4)?.stage).toBe("pr_opened");
      expect(commentScope.isDone()).toBe(false);
    });
  });

  it("links a PR to the issue its body says it fixes", async () => {
    nockNoConfig();

    await withApp(async (probot, db) => {
      await probot.receive({
        id: "1",
        name: "issues",
        payload: {
          action: "assigned",
          issue: { number: 10 },
          assignee: { login: "alice" },
          repository: REPO_PAYLOAD,
        } as never,
      });
      await probot.receive({
        id: "2",
        name: "pull_request",
        payload: {
          action: "opened",
          repository: REPO_PAYLOAD,
          pull_request: { number: 11, body: "Fixes #10", author_association: "CONTRIBUTOR" },
        } as never,
      });

      expect(readItem(db, 10)?.stage).toBe("pr_opened");
      expect(readItem(db, 11)?.stage).toBe("pr_opened");
    });
  });

  it("marks a PR (and its linked issue) merged when it closes merged", async () => {
    nockNoConfig();

    await withApp(async (probot, db) => {
      await probot.receive({
        id: "1",
        name: "issues",
        payload: {
          action: "assigned",
          issue: { number: 20 },
          assignee: { login: "alice" },
          repository: REPO_PAYLOAD,
        } as never,
      });
      await probot.receive({
        id: "2",
        name: "pull_request",
        payload: {
          action: "opened",
          repository: REPO_PAYLOAD,
          pull_request: { number: 21, body: "Closes #20", author_association: "CONTRIBUTOR" },
        } as never,
      });
      await probot.receive({
        id: "3",
        name: "pull_request",
        payload: {
          action: "closed",
          repository: REPO_PAYLOAD,
          pull_request: { number: 21, merged: true, body: "Closes #20" },
        } as never,
      });

      expect(readItem(db, 21)?.stage).toBe("merged");
      expect(readItem(db, 20)?.stage).toBe("merged");
    });
  });

  it("marks a PR abandoned when it closes without merging", async () => {
    nockNoConfig();

    await withApp(async (probot, db) => {
      await probot.receive({
        id: "1",
        name: "pull_request",
        payload: {
          action: "opened",
          repository: REPO_PAYLOAD,
          pull_request: { number: 30, body: null, author_association: "CONTRIBUTOR" },
        } as never,
      });
      await probot.receive({
        id: "2",
        name: "pull_request",
        payload: {
          action: "closed",
          repository: REPO_PAYLOAD,
          pull_request: { number: 30, merged: false, body: null },
        } as never,
      });

      expect(readItem(db, 30)?.stage).toBe("abandoned");
    });
  });

  it("routes a handler's thrown error through onError instead of leaving it unhandled", async () => {
    // A malformed payload - `repository` missing entirely - makes
    // `context.payload.repository.full_name` throw a real TypeError inside
    // the issues.assigned handler.
    //
    // receive() rejecting here is @octokit/webhooks' own design, confirmed
    // by reading its source (not assumed): app.onError doesn't swallow the
    // error, it just gets a first look at it for structured logging before
    // it propagates. What actually keeps a bad delivery from crashing a
    // running process is one layer up, in Probot's real HTTP server
    // (createNodeMiddleware) - it wraps webhooks.verifyAndReceive in its
    // own try/catch and turns a rejection into a 500 response, which
    // GitHub retries. That layer isn't exercised by probot.receive() calls
    // in this test file, so this test only asserts what onError adds: the
    // AggregateError that comes out is exactly the one the handler threw.
    await withApp(async (probot) => {
      await expect(
        probot.receive({
          id: "1",
          name: "issues",
          payload: {
            action: "assigned",
            issue: { number: 99 },
            assignee: { login: "eve" },
          } as never,
        }),
      ).rejects.toThrow(/Cannot read propert(y|ies) of undefined/);
    });
  });

  it("moves a PR into in_review once a review is submitted", async () => {
    nockNoConfig();

    await withApp(async (probot, db) => {
      await probot.receive({
        id: "1",
        name: "pull_request",
        payload: {
          action: "opened",
          repository: REPO_PAYLOAD,
          pull_request: { number: 40, body: null, author_association: "CONTRIBUTOR" },
        } as never,
      });
      await probot.receive({
        id: "2",
        name: "pull_request_review",
        payload: {
          action: "submitted",
          repository: REPO_PAYLOAD,
          pull_request: { number: 40 },
          review: { state: "commented" },
        } as never,
      });

      expect(readItem(db, 40)?.stage).toBe("in_review");
    });
  });
});
