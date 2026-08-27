# Contributing to onramp

Thanks for considering it - a little ironic to have to write this section
for a project about not leaving contributors hanging, so we're holding
ourselves to the same standard: if you get stuck at any point below or once
you've opened a PR, say so in the issue or PR thread and expect a response.

## Getting set up

```sh
git clone https://github.com/<your-fork>/onramp.git
cd onramp
npm install
cp .env.example .env
npm run build
npm test
```

You don't need a real GitHub App registered to work on most of the codebase
- the funnel-state logic, config loading, and nudge-sweep logic are all
tested against a real in-memory SQLite database with a fake GitHub client,
no live webhooks required. See `src/__tests__/` for examples, and
`src/testing/test-db.ts` for the test-database helper.

You only need a real registered GitHub App (see the README's "Running it
yourself" section) if you're testing the actual webhook wiring in
`src/index.ts` end to end.

## Before opening a PR

```sh
npm run lint
npm run format
npm test
npm run build
```

All four should pass clean. CI runs the same four commands.

## Code style

- No unnecessary abstraction: a function is fine until a second call site
  actually needs the generalization.
- Keep GitHub API surface behind small, purpose-built interfaces (see
  `NudgeClient` in `src/nudge/sweep.ts`, `ConfigClient` in
  `src/config/onramp-config.ts`) rather than depending on the full Octokit
  type - it keeps modules trivially testable without a mocking library.
- Comments explain *why*, not *what*. If a comment just restates the code
  below it, delete it.

## Adding a schema migration

`src/database/migrations.ts` holds an ordered array of SQL migrations gated
by `PRAGMA user_version`. To change the schema:

1. Append a new string to the `MIGRATIONS` array - never edit an existing
   entry once it's shipped.
2. Update `src/database/schema.ts` to match, so Drizzle's query builder
   stays in sync with the real columns.
3. Add a test that opens a fresh `:memory:` database and asserts the new
   shape works end to end.

## Filing an issue

Bug reports and feature requests are both welcome. For a bug, include what
you expected, what happened instead, and (if it's webhook-related) the event
payload if you can share it.

## Good first issues

Labeled [`good first issue`](https://github.com/Bryandero98/onramp/labels/good%20first%20issue)
- each one is scoped to a single module and doesn't require understanding the
whole codebase first.
