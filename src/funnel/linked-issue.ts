const CLOSING_KEYWORDS = [
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved",
];

const LINKED_ISSUE_PATTERN = new RegExp(
  `\\b(?:${CLOSING_KEYWORDS.join("|")})\\s*:?\\s*#(\\d+)`,
  "i",
);

/**
 * Pulls the first issue number out of a PR body's closing keywords
 * ("Fixes #123", "Closes: #45", ...), the same syntax GitHub itself
 * recognizes for auto-closing linked issues on merge.
 */
export function parseLinkedIssueNumber(body: string | null | undefined): number | undefined {
  if (!body) return undefined;
  const match = body.match(LINKED_ISSUE_PATTERN);
  return match ? Number(match[1]) : undefined;
}
