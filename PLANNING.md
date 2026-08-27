# onramp - planning notes

MVP scope (done): funnel tracking for issues (claimed) and PRs (opened,
reviewed, closed), configurable staleness thresholds via
`.github/onramp.yml`, automated nudge comments capped at `maxNudges`, a
first-time-contributor welcome comment, and a cross-installation hourly
sweep.

Below are five good-first-issues to file once this repo is public. Delete
this file (or move it to actual issues) once they're filed - same rule as
every other project we've bootstrapped this way.

## 1. Public health badge

Add an HTTP route (Probot exposes `app.route()` -> a real Express router)
that serves a shields.io-style SVG badge showing a repo's average
time-to-first-review, computed from `funnel_items` rows that reached
`in_review`. Good first issue because it's additive, touches one new file,
and doesn't require understanding the webhook/nudge flow at all.

## 2. GitLab support

Right now `NudgeClient` (`src/nudge/sweep.ts`) and the webhook handlers in
`src/index.ts` assume GitHub. Design a small VCS-agnostic adapter interface
(issue-assigned, PR/MR-opened, review-submitted, PR/MR-closed) and implement
a second adapter for GitLab merge request webhooks. The funnel-state and
nudge logic underneath shouldn't need to change at all - if it does, that's
a sign the abstraction boundary is in the wrong place.

## 3. Quiet hours

Add a `quietHours` option to `.github/onramp.yml` (e.g.
`quietHours: { start: 22, end: 8, timezone: "America/Bogota" }`) so nudges
never post in the middle of a maintainer's night - queue them for the next
sweep that falls outside the window instead of skipping them entirely.

## 4. `/onramp report` slash command

Listen for an issue comment containing `/onramp report` and reply with the
repo's current funnel snapshot: how many items are in each stage, how many
are currently stale, and the oldest stale item. Useful for a maintainer who
wants a status check without waiting for the next automated nudge.

## 5. Postgres option for shared deployments

SQLite is the right default for a single self-hosted instance, but anyone
running onramp as a shared instance across many installations will want
real concurrent writes. Add a `DATABASE_URL`-driven Postgres path alongside
the existing SQLite one, behind the same `Db` type from
`src/database/db.ts` so `src/funnel/` and `src/nudge/` don't need to change.
