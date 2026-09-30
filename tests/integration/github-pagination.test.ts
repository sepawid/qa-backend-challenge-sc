import { describe, expect, it, vi } from "vitest";
import { GitHubPullRequestClient } from "../../src/core/github-client.js";
import { countOpenNonDraftPullRequests } from "../../src/business/pull-request-monitor.js";
import {
  HttpError,
  PaginationError,
  SchemaValidationError,
} from "../../src/core/errors.js";
import {
  page1Fixture,
  page2Fixture,
  page3Fixture,
} from "../../src/demo/fixtures/github-pulls-pages.js";
import { createFixtureFetch } from "../../src/demo/fixture-fetch.js";

const VALID_QUERY = "state=open&per_page=100&sort=created&direction=asc";

describe("Integration: Deterministic multi-page pagination & defensive controls", () => {
  it("fetches all 3 pages sequentially, validates schemas, and calculates exact open non-draft total", async () => {
    const requestedUrls: string[] = [];
    const fixtureFetch = createFixtureFetch();

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      requestedUrls.push(url);
      return fixtureFetch(url);
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await client.fetchAllOpenPullRequests();

    expect(requestedUrls).toHaveLength(3);
    expect(result.pagesFetched).toBe(3);
    expect(result.recordsReceived).toBe(6);
    expect(result.uniqueRecords).toBe(6);
    expect(result.duplicatesSkipped).toBe(0);
    expect(result.isComplete).toBe(true);

    // Business count verification
    // 6 records total: 4 open non-draft, 2 open drafts (id 102 and 105)
    const countable = countOpenNonDraftPullRequests(result.pullRequests);
    expect(countable).toBe(4);
  });

  it("handles a valid empty last page correctly", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const pageParam = parsed.searchParams.get("page");

      if (pageParam === "2") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: `<https://api.github.com/repos/appwrite/appwrite/pulls?${VALID_QUERY}&page=2>; rel="next"`,
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await client.fetchAllOpenPullRequests();
    expect(result.pagesFetched).toBe(2);
    expect(result.recordsReceived).toBe(2);
    expect(result.uniqueRecords).toBe(2);
    expect(result.isComplete).toBe(true);
  });

  it("detects pagination loops and refuses infinite requests", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const isPage2 = parsed.searchParams.get("page") === "2";
      // Loop points page 2 back to page 1
      const nextTarget = isPage2
        ? `https://api.github.com/repos/appwrite/appwrite/pulls?${VALID_QUERY}`
        : `https://api.github.com/repos/appwrite/appwrite/pulls?${VALID_QUERY}&page=2`;

      // Return unique IDs on page 2 so cycle detection fires rather than duplicate ID
      const items = isPage2 ? page2Fixture : page1Fixture;

      return new Response(JSON.stringify(items), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: `<${nextTarget}>; rel="next"`,
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrowError(
      /Pagination cycle detected/i,
    );
  });

  it("aborts and refuses untrusted origins in next links (defense against SSRF / credential theft)", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: `<https://attacker.example.com/steal-token?${VALID_QUERY}&page=2>; rel="next"`,
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrowError(
      /Refusing untrusted pagination origin/i,
    );
  });

  it("refuses unencrypted http: links in next relations", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: `<http://api.github.com/repos/appwrite/appwrite/pulls?${VALID_QUERY}&page=2>; rel="next"`,
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrowError(
      /Refusing unencrypted pagination URL/i,
    );
  });

  it("deduplicates records if duplicate PR IDs appear across different pages with accurate counter invariants", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const isPage2 = parsed.searchParams.get("page") === "2";
      // Both pages return page1Fixture which shares id 101 and 102
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(isPage2
            ? {}
            : {
                link: `<https://api.github.com/repos/appwrite/appwrite/pulls?${VALID_QUERY}&page=2>; rel="next"`,
              }),
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await client.fetchAllOpenPullRequests();
    expect(result.pagesFetched).toBe(2);
    expect(result.recordsReceived).toBe(4); // 2 records on page 1 + 2 records on page 2
    expect(result.uniqueRecords).toBe(2);   // 2 unique records
    expect(result.duplicatesSkipped).toBe(2); // 2 duplicates skipped
    expect(result.recordsReceived).toBe(result.uniqueRecords + result.duplicatesSkipped);
    expect(result.pullRequests).toHaveLength(2);
  });

  it("fails with PaginationError if duplicate PR IDs appear within the same page", async () => {
    const duplicateWithinPage = [page1Fixture[0], page1Fixture[0]];
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(duplicateWithinPage), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(PaginationError);
    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(/within page 1/i);
  });

  it("fails with PaginationError if first numeric repository ID does not match confirmed base repository", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          // Repos ID 999 does not match 180190854 from page1Fixture
          link: `<https://api.github.com/repositories/999/pulls?${VALID_QUERY}&page=2>; rel="next"`,
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(PaginationError);
    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(/mismatched repository ID/i);
  });

  it("fails with PaginationError if repository ID in next link changes later in pagination", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/repos/appwrite/appwrite/pulls") {
        return new Response(JSON.stringify(page1Fixture), {
          status: 200,
          headers: {
            "content-type": "application/json",
            // 180190854 matches confirmed base repo
            link: `<https://api.github.com/repositories/180190854/pulls?${VALID_QUERY}&page=2>; rel="next"`,
          },
        });
      }
      return new Response(JSON.stringify(page2Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          // Page 2 switches to 999
          link: `<https://api.github.com/repositories/999/pulls?${VALID_QUERY}&page=3>; rel="next"`,
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(PaginationError);
    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(/mismatched repository ID/i);
  });

  it("refuses next link that alters query parameter semantics (e.g. missing sort/direction)", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          // Next link omits sort and direction, changing server ordering
          link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=2>; rel="next"',
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(PaginationError);
    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(/invalid or missing "sort" parameter/i);
  });

  it("refuses next link that alters per_page or state", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=all&per_page=50&sort=created&direction=asc&page=2>; rel="next"',
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(PaginationError);
    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(/invalid or missing "state" parameter/i);
  });

  it("refuses next link with duplicate contradictory query parameters", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&sort=created&sort=updated&direction=asc&page=2>; rel="next"',
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(PaginationError);
    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(/duplicate "sort" query parameter/i);
  });

  it("constructs initial URL with sort=created and direction=asc", async () => {
    let initialUrl = "";
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      initialUrl = url;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await client.fetchAllOpenPullRequests();
    const parsed = new URL(initialUrl);
    expect(parsed.searchParams.get("sort")).toBe("created");
    expect(parsed.searchParams.get("direction")).toBe("asc");
  });

  it("enforces maxPages limit and fails without presenting a partial result as complete", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount += 1;
      const uniquePrs = [
        {
          id: 1000 + callCount,
          number: callCount,
          state: "open",
          draft: false,
          title: `PR ${callCount}`,
          html_url: `https://github.com/appwrite/appwrite/pull/${callCount}`,
          created_at: "2024-01-01T00:00:00Z",
          labels: [],
          base: { repo: { id: 180190854, full_name: "appwrite/appwrite" } },
        },
      ];

      return new Response(JSON.stringify(uniquePrs), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: `<https://api.github.com/repos/appwrite/appwrite/pulls?${VALID_QUERY}&page=${callCount + 1}>; rel="next"`,
        },
      });
    });

    const client = new GitHubPullRequestClient({
      maxPages: 3,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrowError(
      /Pagination exceeded safety limit of 3 pages/i,
    );
  });

  it("reports HTTP 403 with rate limit diagnostics and body snippet on failure", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response("API rate limit exceeded", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1700000000",
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    let caughtError: unknown;
    try {
      await client.fetchAllOpenPullRequests();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(HttpError);
    const httpErr = caughtError as HttpError;
    expect(httpErr.context.status).toBe(403);
    expect(httpErr.context.rateLimitRemaining).toBe(0);
    expect(httpErr.message).toContain("API rate limit exceeded");
    expect(httpErr.message).toContain("rate limit reset:");
    expect(httpErr.context.responseBody).toBe("API rate limit exceeded");
  });

  it("refuses pagination URLs with an unexpected path (defense against endpoint hijacking)", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: `<https://api.github.com/user/emails?${VALID_QUERY}&page=2>; rel="next"`,
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrowError(
      /unexpected path/i,
    );
  });

  it("refuses pagination URLs containing a fragment", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: `<https://api.github.com/repos/appwrite/appwrite/pulls?${VALID_QUERY}&page=2#malicious>; rel="next"`,
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrowError(
      /fragment/i,
    );
  });

  it("fails with PaginationError on ambiguous rel=next (never reports partial data as complete)", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: [
            `<https://api.github.com/repos/appwrite/appwrite/pulls?${VALID_QUERY}&page=2>; rel="next"`,
            `<https://api.github.com/repos/appwrite/appwrite/pulls?${VALID_QUERY}&page=3>; rel="next"`,
          ].join(", "),
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(PaginationError);
  });
});
