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

export async function fetchSearchTotalCount(
  query: string,
  token?: string,
  timeoutMs = 10_000,
): Promise<SearchResponse | null> {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "qa-challenge-live-test",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      `GitHub Search API request failed (${url}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`GitHub Search API unexpected redirect (${response.status})`);
  }

  const remainingHeader = response.headers.get("x-ratelimit-remaining");
  const retryAfterHeader = response.headers.get("retry-after");

  if (response.status === 429) {
    console.warn(`[LIVE SEARCH ORACLE] GitHub Search API rate-limited (HTTP 429); oracle comparison will be skipped.`);
    return null;
  }

  if (response.status === 403) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // ignore
    }

    const isPrimaryRateLimit = remainingHeader !== null && Number(remainingHeader) === 0;
    const isSecondaryRateLimit =
      retryAfterHeader !== null || /rate limit|secondary rate limit/i.test(bodyText);

    if (isPrimaryRateLimit || isSecondaryRateLimit) {
      console.warn(
        `[LIVE SEARCH ORACLE] GitHub Search API rate-limited (HTTP 403, remaining=${remainingHeader ?? "n/a"}); oracle comparison will be skipped.`,
      );
      return null;
    }

    // Non-rate-limit 403 (policy block, forbidden resource) must fail loudly
    throw new Error(
      `GitHub Search API returned HTTP 403 Forbidden (not rate-limited): ${bodyText || response.statusText}`,
    );
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // ignore
    }
    throw new Error(`GitHub Search API error (${response.status}): ${bodyText || response.statusText}`);
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
    expect(result.recordsReceived).toBeGreaterThanOrEqual(0);
    expect(result.recordsReceived).toBe(result.uniqueRecords + result.duplicatesSkipped);

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

    // 3. Business rule calculation & exact metric relations
    const openNonDrafts = filterOpenNonDraftPullRequests(result.pullRequests);
    const finalCount = countOpenNonDraftPullRequests(result.pullRequests);
    const draftPullRequests = result.pullRequests.filter((pr) => pr.draft);
    const draftCount = draftPullRequests.length;

    expect(openNonDrafts.every((pr) => pr.state === "open" && !pr.draft)).toBe(true);
    expect(draftPullRequests.every((pr) => pr.state === "open" && pr.draft)).toBe(true);
    expect(finalCount + draftCount).toBe(result.uniqueRecords);

    // 4. Independent verification via GitHub Search API oracle
    const [nonDraftSearchResult, openSearchResult] = await Promise.all([
      fetchSearchTotalCount(
        "repo:appwrite/appwrite is:pr is:open draft:false",
        config.GITHUB_TOKEN,
        config.GITHUB_TIMEOUT_MS,
      ),
      fetchSearchTotalCount(
        "repo:appwrite/appwrite is:pr is:open",
        config.GITHUB_TOKEN,
        config.GITHUB_TIMEOUT_MS,
      ),
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
        `  • Total Records Retrieved: ${result.recordsReceived}\n` +
        `  • Unique PRs: ${result.uniqueRecords}\n` +
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
      const openDelta = Math.abs(result.uniqueRecords - openSearchResult.total_count);
      console.info(
        `[LIVE SEARCH ORACLE] Total Open comparison: fetched(unique)=${result.uniqueRecords}, oracle=${openSearchResult.total_count}, delta=${openDelta}, tolerance=${liveTolerance}`,
      );
      expect(openDelta).toBeLessThanOrEqual(liveTolerance);
    }
  });
});
