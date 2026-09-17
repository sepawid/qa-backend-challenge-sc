import { describe, expect, it } from "vitest";
import { GitHubPullRequestClient } from "../../src/core/github-client.js";
import {
  countOpenNonDraftPullRequests,
  filterOpenNonDraftPullRequests,
} from "../../src/business/pull-request-monitor.js";
import { parseEnvironmentConfig } from "../../src/schemas/config.schema.js";

describe("Live Integration: Appwrite repository open pull requests", () => {
  it("exhaustively navigates all live pages via rel=next, validates contracts, and calculates accurate open non-draft total", async () => {
    const config = parseEnvironmentConfig();

    const client = new GitHubPullRequestClient({
      token: config.GITHUB_TOKEN,
      timeoutMs: config.GITHUB_TIMEOUT_MS,
      maxPages: config.GITHUB_MAX_PAGES,
    });

    const result = await client.fetchAllOpenPullRequests();

    // 1. Completion & pagination integrity
    expect(result.isComplete).toBe(true);
    expect(result.pagesFetched).toBeGreaterThanOrEqual(1);
    expect(result.recordsReceived).toBeGreaterThan(0);

    // 2. Schema compliance across entire live dataset
    for (const pr of result.pullRequests) {
      expect(pr.state).toBe("open");
      expect(typeof pr.draft).toBe("boolean");
      expect(typeof pr.id).toBe("number");
      expect(typeof pr.title).toBe("string");
      expect(pr.html_url).toMatch(/^https:\/\/github\.com\/appwrite\/appwrite\/pull\/\d+$/);
    }

    // 3. Independent business rule calculation
    const openNonDrafts = filterOpenNonDraftPullRequests(result.pullRequests);
    const finalCount = countOpenNonDraftPullRequests(result.pullRequests);

    expect(finalCount).toBe(openNonDrafts.length);
    expect(openNonDrafts.every((pr) => pr.state === "open" && !pr.draft)).toBe(true);

    const draftCount = result.recordsReceived - finalCount;
    expect(draftCount).toBeGreaterThanOrEqual(0);

    // Observability report for CI logs
    console.info(
      `[LIVE GITHUB VERIFICATION SUMMARY]\n` +
      `  • Repository: appwrite/appwrite\n` +
      `  • Observation Window: ${result.startedAt} -> ${result.completedAt} (${result.durationMs}ms)\n` +
      `  • Pages Fetched: ${result.pagesFetched}\n` +
      `  • Total Open PRs Retrieved: ${result.recordsReceived}\n` +
      `  • Draft PRs Excluded: ${draftCount}\n` +
      `  • Final Open Non-Draft Count: ${finalCount}\n` +
      `  • GitHub Rate-Limit Remaining: ${result.rateLimit?.remaining ?? "unknown"}`
    );
  });
});
