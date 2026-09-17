import { describe, expect, it } from "vitest";
import {
  countOpenNonDraftPullRequests,
  filterOpenNonDraftPullRequests,
} from "../../src/business/pull-request-monitor.js";
import type { GitHubPullRequest } from "../../src/schemas/github-pull.schema.js";

function makePr(id: number, state: "open" | "closed", draft: boolean): GitHubPullRequest {
  return {
    id,
    number: id,
    state,
    draft,
    title: `PR ${id}`,
    html_url: `https://github.com/appwrite/appwrite/pull/${id}`,
    created_at: "2024-01-01T00:00:00Z",
    labels: [],
  };
}

describe("Business Logic: pull-request-monitor", () => {
  it("includes open non-draft pull requests in the count", () => {
    const prs = [makePr(1, "open", false)];
    expect(countOpenNonDraftPullRequests(prs)).toBe(1);
    expect(filterOpenNonDraftPullRequests(prs)).toHaveLength(1);
  });

  it("excludes open draft pull requests from the count", () => {
    const prs = [makePr(1, "open", true)];
    expect(countOpenNonDraftPullRequests(prs)).toBe(0);
    expect(filterOpenNonDraftPullRequests(prs)).toHaveLength(0);
  });

  it("excludes closed non-draft pull requests from the count", () => {
    const prs = [makePr(1, "closed", false)];
    expect(countOpenNonDraftPullRequests(prs)).toBe(0);
  });

  it("excludes closed draft pull requests from the count", () => {
    const prs = [makePr(1, "closed", true)];
    expect(countOpenNonDraftPullRequests(prs)).toBe(0);
  });

  it("returns zero for an empty list", () => {
    expect(countOpenNonDraftPullRequests([])).toBe(0);
    expect(filterOpenNonDraftPullRequests([])).toEqual([]);
  });

  it("accurately handles a mixed state matrix", () => {
    const mixed = [
      makePr(1, "open", false),  // KEEP
      makePr(2, "open", true),   // exclude (draft)
      makePr(3, "closed", false),// exclude (closed)
      makePr(4, "closed", true), // exclude (closed draft)
      makePr(5, "open", false),  // KEEP
    ];

    expect(countOpenNonDraftPullRequests(mixed)).toBe(2);
    const filtered = filterOpenNonDraftPullRequests(mixed);
    expect(filtered.map((p) => p.id)).toEqual([1, 5]);
  });

  it("does not mutate the input array", () => {
    const input = Object.freeze([makePr(1, "open", false), makePr(2, "open", true)]);
    const filtered = filterOpenNonDraftPullRequests(input);
    expect(filtered).toHaveLength(1);
    expect(input).toHaveLength(2);
  });
});
