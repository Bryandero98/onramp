import { parseLinkedIssueNumber } from "../funnel/linked-issue";

describe("parseLinkedIssueNumber", () => {
  it.each([
    ["Fixes #42", 42],
    ["This closes: #7", 7],
    ["Resolved #123 and cleaned up", 123],
    ["fix #1", 1],
    ["no closing keyword here, just #99 mentioned", undefined],
    ["", undefined],
    [null, undefined],
  ])("parses %j as %j", (body, expected) => {
    expect(parseLinkedIssueNumber(body)).toBe(expected);
  });
});
