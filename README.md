# onramp

A [Probot](https://probot.github.io) GitHub App that watches your project's
**contributor funnel** and nudges it back into motion when it stalls.

## The problem

Every open-source project has the same funnel:

```
issue labeled  ->  someone claims it  ->  PR opened  ->  PR reviewed  ->  merged
```

People fall out of that funnel silently, at every stage. An issue gets
assigned and then nobody hears from the assignee again. A PR goes up and sits
for three weeks because the one maintainer who usually reviews that area is
busy. Nobody's at fault - it just happens, and by the time anyone notices,
the contributor has moved on and stopped checking back.

onramp doesn't review code and it doesn't triage issues. It just watches how
long something has been sitting still, and says something before the silence
becomes the reason a contributor doesn't come back.

## What it does

- Tracks every issue that gets assigned and every PR that gets opened, per
  repo, in its own lightweight database.
- On a schedule, checks for items that have gone quiet longer than your
  configured threshold:
  - an assigned issue with no linked PR yet ("stale claim")
  - an open PR with no review activity yet ("stale review")
- Posts one friendly, low-pressure comment when an item goes stale - never
  more than `maxNudges` times per item, so a genuinely stuck item gets
  flagged, not spammed.
- Optionally welcomes first-time contributors the moment their first PR
  lands.
- Everything is configurable per repo via `.github/onramp.yml`, and works
  with sane defaults if that file doesn't exist at all.

## Configuration

Drop a `.github/onramp.yml` in any repo onramp is installed on:

```yaml
# Days an assigned issue can go without a linked PR before a nudge.
staleClaimDays: 14

# Days an open PR can go without a review before a nudge.
staleReviewDays: 7

# Hard cap on nudges per item.
maxNudges: 2

# Post a welcome comment on a first-time contributor's first PR.
welcomeFirstTimeContributors: true
```

All fields are optional; omitted fields fall back to the defaults shown
above.

## Running it yourself

onramp is a standard Probot app - see the
[Probot deployment docs](https://probot.github.io/docs/deployment/) for the
full picture. The short version:

1. **Register a GitHub App.** Easiest path is the
   [manifest flow](https://probot.github.io/docs/development/#manifest-flow):
   run `npm run dev` locally (see below) and follow the prompt, or create one
   manually at <https://github.com/settings/apps/new> using the permissions
   and events listed in [`app.yml`](./app.yml).
2. **Copy `.env.example` to `.env`** and fill in the app ID, private key path,
   and webhook secret from the app you just registered.
3. **Install dependencies and run:**

   ```sh
   npm install
   npm run build
   npm start
   ```

   For local development against real webhook deliveries, use
   [smee.io](https://smee.io/new) for `WEBHOOK_PROXY_URL` and run `npm run dev`
   instead.

By default onramp keeps its funnel-tracking database at `./onramp.db`
(configurable via `ONRAMP_DB_PATH`) and sweeps every installed repo once an
hour (configurable via `ONRAMP_SWEEP_INTERVAL_MS`).

## Architecture

- **`src/funnel/`** - the funnel state machine: what stage is each tracked
  issue/PR in, and the pure queries that decide what counts as stale. No
  GitHub API calls live here, which is what makes it fully testable against
  a real in-memory SQLite database instead of mocks.
- **`src/nudge/`** - turns a stale item into an actual GitHub comment, via a
  minimal `NudgeClient` interface rather than a full Octokit type, so it's
  trivial to fake in tests.
- **`src/config/`** - loads and validates `.github/onramp.yml` per repo.
- **`src/database/`** - Drizzle ORM over `better-sqlite3`, with schema
  migrations gated by `PRAGMA user_version` (see `src/database/migrations.ts`
  - append a new migration, never edit a shipped one).
- **`src/index.ts`** - the Probot entrypoint: wires webhook events to the
  funnel-state functions, and runs the cross-installation staleness sweep on
  an interval.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) - and check the
[good first issues](https://github.com/Bryandero98/onramp/labels/good%20first%20issue)
for a concrete place to start.

## License

[MIT](./LICENSE)
