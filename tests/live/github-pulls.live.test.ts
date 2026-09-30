import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GitHubPullRequestClient } from "../../src/core/github-client.js";
import {
  countOpenNonDraftPullRequests,
  filterOpenNonDraftPullRequests,
} from "../../src/business/pull-request-monitor.js";
import { parseEnvironmentConfig } from "../../src/schemas/config.schema.js";

const searchResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
});

type SearchResponse = z.infer<typeof searchResponseSchema>;

async function fetchSearchTotalCount(query: string, token?: string): Promise<SearchResponse | null> {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "qa-challenge-live-test",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });
  if (response.status === 403 || response.status === 429) {
    console.warn(
      `[LIVE SEARCH ORACLE] GitHub Search API rate-limited (${response.status}); oracle comparison will be skipped.`,
    );
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub Search API error (${response.status}): ${response.statusText}`);
  }

  const json = await response.json();
  return searchResponseSchema.parse(json);
}

describe("Live Integration: Appwrite repository open pull requests", () => {
  it("exhaustively navigates all live pages via rel=next, validates contracts, and calculates accurate open non-draft total", async () => {
    const config = parseEnvironmentConfig();
    const liveTolerance = config.LIVE_TOLERANCE;

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

    const expectedMinPages = Math.ceil(result.recordsReceived / 100);
    // pagesFetched should match expected pages (or expected + 1 if an additional empty page was served before next link terminated)
    expect(
      result.pagesFetched === expectedMinPages || result.pagesFetched === expectedMinPages + 1,
    ).toBe(true);

    // 2. Schema compliance & PR issue number uniqueness across entire live dataset
    const seenNumbers = new Set<number>();

    for (const pr of result.pullRequests) {
      expect(pr.state).toBe("open");
      expect(typeof pr.draft).toBe("boolean");
      expect(typeof pr.id).toBe("number");
      expect(typeof pr.number).toBe("number");
      expect(typeof pr.title).toBe("string");
      expect(pr.html_url).toMatch(/^https:\/\/github\.com\/appwrite\/appwrite\/pull\/\d+$/);

      expect(seenNumbers.has(pr.number)).toBe(false);
      seenNumbers.add(pr.number);
    }

    // 3. Business rule calculation
    const openNonDrafts = filterOpenNonDraftPullRequests(result.pullRequests);
    const finalCount = countOpenNonDraftPullRequests(result.pullRequests);
    const draftPullRequests = result.pullRequests.filter((pr) => pr.draft);
    const draftCount = draftPullRequests.length;

    expect(openNonDrafts.every((pr) => pr.state === "open" && !pr.draft)).toBe(true);
    expect(draftPullRequests.every((pr) => pr.state === "open" && pr.draft)).toBe(true);
    expect(finalCount + draftCount).toBe(result.recordsReceived);

    // 4. Independent verification via GitHub Search API oracle
    const [nonDraftSearchResult, openSearchResult] = await Promise.all([
      fetchSearchTotalCount(
        "repo:appwrite/appwrite is:pr is:open draft:false",
        config.GITHUB_TOKEN,
      ),
      fetchSearchTotalCount("repo:appwrite/appwrite is:pr is:open", config.GITHUB_TOKEN),
    ]);

    const nonDraftOracleSummary = nonDraftSearchResult
      ? `${nonDraftSearchResult.total_count} (incomplete: ${nonDraftSearchResult.incomplete_results})`
      : "rate-limited (skipped)";
    const openOracleSummary = openSearchResult
      ? `${openSearchResult.total_count} (incomplete: ${openSearchResult.incomplete_results})`
      : "rate-limited (skipped)";

    console.info(
      `[LIVE GITHUB VERIFICATION SUMMARY]\n` +
        `  • Repository: appwrite/appwrite\n` +
        `  • Observation Window: ${result.startedAt} -> ${result.completedAt} (${result.durationMs}ms)\n` +
        `  • Pages Fetched: ${result.pagesFetched}\n` +
        `  • Total Open PRs Retrieved: ${result.recordsReceived}\n` +
        `  • Draft PRs Excluded: ${draftCount}\n` +
        `  • Final Open Non-Draft Count: ${finalCount}\n` +
        `  • Duplicates Skipped Across Pages: ${result.duplicatesSkipped}\n` +
        `  • GitHub Rate-Limit Remaining: ${result.rateLimit?.remaining ?? "unknown"}\n` +
        `  • Search Oracle (Open Non-Draft): ${nonDraftOracleSummary}\n` +
        `  • Search Oracle (Total Open): ${openOracleSummary}`,
    );

    if (!nonDraftSearchResult || nonDraftSearchResult.incomplete_results) {
      console.warn(
        "[LIVE SEARCH ORACLE] Incomplete results or rate-limit encountered for open non-draft PR search query; skipping oracle assertion.",
      );
    } else {
      const nonDraftDelta = Math.abs(finalCount - nonDraftSearchResult.total_count);
      console.info(
        `[LIVE SEARCH ORACLE] Non-Draft comparison: fetched=${finalCount}, oracle=${nonDraftSearchResult.total_count}, delta=${nonDraftDelta}, tolerance=${liveTolerance}`,
      );
      expect(nonDraftDelta).toBeLessThanOrEqual(liveTolerance);
    }

    if (!openSearchResult || openSearchResult.incomplete_results) {
      console.warn(
        "[LIVE SEARCH ORACLE] Incomplete results or rate-limit encountered for total open PR search query; skipping oracle assertion.",
      );
    } else {
      const openDelta = Math.abs(result.recordsReceived - openSearchResult.total_count);
      console.info(
        `[LIVE SEARCH ORACLE] Total Open comparison: fetched=${result.recordsReceived}, oracle=${openSearchResult.total_count}, delta=${openDelta}, tolerance=${liveTolerance}`,
      );
      expect(openDelta).toBeLessThanOrEqual(liveTolerance);
    }
  });
});
