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
} from "../fixtures/github-pulls-pages.js";

describe("Integration: Deterministic multi-page pagination & defensive controls", () => {
  it("fetches all 3 pages sequentially, validates schemas, and calculates exact open non-draft total", async () => {
    const requestedUrls: string[] = [];

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      requestedUrls.push(url);
      const parsed = new URL(url);
      const pageParam = parsed.searchParams.get("page");

      if (pageParam === null || pageParam === "1") {
        return new Response(JSON.stringify(page1Fixture), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=2>; rel="next"',
          },
        });
      }

      if (pageParam === "2") {
        return new Response(JSON.stringify(page2Fixture), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=3>; rel="next"',
          },
        });
      }

      if (pageParam === "3") {
        return new Response(JSON.stringify(page3Fixture), {
          status: 200,
          headers: {
            "content-type": "application/json",
            // No next link on last page
          },
        });
      }

      throw new Error(`Unexpected URL called: ${url}`);
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await client.fetchAllOpenPullRequests();

    expect(requestedUrls).toHaveLength(3);
    expect(result.pagesFetched).toBe(3);
    expect(result.recordsReceived).toBe(6);
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
          link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=2>; rel="next"',
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await client.fetchAllOpenPullRequests();
    expect(result.pagesFetched).toBe(2);
    expect(result.recordsReceived).toBe(2);
    expect(result.isComplete).toBe(true);
  });

  it("detects pagination loops and refuses infinite requests", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const isPage2 = parsed.searchParams.get("page") === "2";
      // Loop points page 2 back to page 1
      const nextTarget = isPage2
        ? "https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100"
        : "https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=2";

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
          link: '<https://attacker.example.com/steal-token>; rel="next"',
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
          link: '<http://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=2>; rel="next"',
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

  it("fails with PaginationError if duplicate PR IDs appear across different pages", async () => {
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
                link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=2>; rel="next"',
              }),
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrowError(
      /Duplicate pull request id=101/i,
    );
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
        },
      ];

      return new Response(JSON.stringify(uniquePrs), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: `<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=${callCount + 1}>; rel="next"`,
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

  it("reports HTTP 403 with rate limit diagnostics on failure", async () => {
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
  });

  it("refuses pagination URLs with an unexpected path (defense against endpoint hijacking)", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.github.com/user/emails?page=2>; rel="next"',
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
          link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=2#malicious>; rel="next"',
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
});
