import { describe, expect, it, vi } from "vitest";
import {
  GitHubPullRequestClient,
  type PageFetchedEvent,
} from "../../src/core/github-client.js";
import {
  HttpError,
  SchemaValidationError,
  TransportError,
} from "../../src/core/errors.js";
import { page1Fixture } from "../fixtures/github-pulls-pages.js";

describe("Core: GitHubPullRequestClient", () => {
  it("fetches single page successfully with default headers", async () => {
    const recordedHeaders: Record<string, string>[] = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      recordedHeaders.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "55",
          "x-ratelimit-limit": "60",
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await client.fetchAllOpenPullRequests();

    expect(result.pagesFetched).toBe(1);
    expect(result.recordsReceived).toBe(2);
    expect(result.pullRequests).toHaveLength(2);
    expect(result.rateLimit?.remaining).toBe(55);
    expect(result.isComplete).toBe(true);

    // Verify sent headers
    expect(recordedHeaders[0]?.["Accept"]).toBe("application/vnd.github+json");
    expect(recordedHeaders[0]?.["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(recordedHeaders[0]?.["Authorization"]).toBeUndefined();
  });

  it("includes Authorization header when token is provided", async () => {
    const recordedHeaders: Record<string, string>[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      recordedHeaders.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new GitHubPullRequestClient({
      token: "ghp_secret_token_123",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await client.fetchAllOpenPullRequests();
    expect(recordedHeaders[0]?.["Authorization"]).toBe("Bearer ghp_secret_token_123");
  });

  it("triggers onPageFetched callback for each retrieved page", async () => {
    const events: PageFetchedEvent[] = [];
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "40",
        },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
      onPageFetched: (e) => events.push(e),
    });

    await client.fetchAllOpenPullRequests();
    expect(events).toHaveLength(1);
    expect(events[0]?.pageNumber).toBe(1);
    expect(events[0]?.itemCount).toBe(2);
    expect(events[0]?.accumulatedCount).toBe(2);
    expect(events[0]?.rateLimitRemaining).toBe(40);
  });

  it("throws HttpError when API returns non-2xx status code", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response("Not Found", { status: 404 });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(HttpError);
  });

  it("throws HttpError and rejects redirects to protect credentials (redirect: manual)", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(null, {
        status: 301,
        headers: { Location: "https://evil.example.com/steal" },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(HttpError);
  });

  it("throws SchemaValidationError when JSON response does not conform to Zod schema", async () => {
    const malformedData = [{ id: "not-a-number", state: "open" }];
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(malformedData), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(SchemaValidationError);
  });

  it("throws TransportError when network request throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(TransportError);
  });

  it("includes page number and Zod field path in SchemaValidationError context", async () => {
    const malformedData = [{ id: "not-a-number", state: "open" }];
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(malformedData), {
        status: 200,
        headers: { "content-type": "application/json" },
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

    expect(caughtError).toBeInstanceOf(SchemaValidationError);
    const schemaErr = caughtError as SchemaValidationError;
    expect(schemaErr.context.page).toBe(1);
    expect(schemaErr.context.zodIssues).toBeDefined();
    expect(schemaErr.context.zodIssues!.length).toBeGreaterThan(0);
    // Zod issues should reference the failing field path
    expect(schemaErr.context.zodIssues!.some((issue) => issue.includes("id") || issue.includes("number"))).toBe(true);
  });

  it("throws SchemaValidationError for malformed (non-JSON) response body", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response("this is {not valid json", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(SchemaValidationError);
  });

  it("wraps AbortError from fetch timeout as TransportError", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const mockFetch = vi.fn().mockRejectedValue(abortError);

    const client = new GitHubPullRequestClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    let caughtError: unknown;
    try {
      await client.fetchAllOpenPullRequests();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(TransportError);
    const transportErr = caughtError as TransportError;
    expect(transportErr.message).toContain("aborted");
    expect(transportErr.context.page).toBe(1);
  });
});
