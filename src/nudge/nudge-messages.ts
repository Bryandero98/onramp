import type { StaleItem } from "../funnel/funnel-state";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(lastActivityAt: number, now: number): number {
  return Math.floor((now - lastActivityAt) / DAY_MS);
}

export function staleClaimMessage(item: StaleItem, now: number): string {
  const days = daysSince(item.lastActivityAt, now);
  const mention = item.claimedBy ? `@${item.claimedBy}` : "there";

  return (
    `Hi ${mention} - this issue has been assigned for ${days} days with no linked pull request yet. ` +
    `No pressure at all: if you're still working on it, a quick comment (even "still going, just slow") keeps it yours. ` +
    `If plans changed, unassigning yourself frees it up for someone else.\n\n` +
    `_This is an automated nudge from [onramp](https://github.com/Bryandero98/onramp) - configure or disable it in \`.github/onramp.yml\`._`
  );
}

export function stalePullRequestMessage(item: StaleItem, now: number): string {
  const days = daysSince(item.lastActivityAt, now);

  return (
    `This pull request has been open for ${days} days without a review. ` +
    `Flagging it so it doesn't fall through the cracks - maintainers, could someone take a look?\n\n` +
    `_This is an automated nudge from [onramp](https://github.com/Bryandero98/onramp) - configure or disable it in \`.github/onramp.yml\`._`
  );
}
