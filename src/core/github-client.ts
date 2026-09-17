import {
  githubPullRequestPageSchema,
  type GitHubPullRequest,
} from "../schemas/github-pull.schema.js";
import { getNextLink } from "./link-header.js";
import {
  HttpError,
  PaginationError,
  SchemaValidationError,
  TransportError,
} from "./errors.js";

export const DEFAULT_ENDPOINT = "https://api.github.com/repos/appwrite/appwrite/pulls";
export const DEFAULT_MAX_PAGES = 20;
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface PageFetchedEvent {
  readonly pageNumber: number;
  readonly url: string;
  readonly itemCount: number;
  readonly accumulatedCount: number;
  readonly rateLimitRemaining?: number | undefined;
  readonly rateLimitReset?: string | undefined;
  readonly durationMs: number;
}

export interface RateLimitInfo {
  readonly limit?: number | undefined;
  readonly remaining?: number | undefined;
  readonly reset?: string | undefined;
  readonly used?: number | undefined;
}

export interface FetchAllResult {
  readonly pullRequests: readonly GitHubPullRequest[];
  readonly pagesFetched: number;
  readonly recordsReceived: number;
  readonly rateLimit?: RateLimitInfo | undefined;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly isComplete: boolean;
}

export interface GitHubClientOptions {
  readonly endpoint?: string | undefined;
  readonly token?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxPages?: number | undefined;
  readonly onPageFetched?: ((event: Readonly<PageFetchedEvent>) => void) | undefined;
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export class GitHubPullRequestClient {
  private readonly endpoint: string;
  private readonly trustedOrigin: string;
  private readonly trustedPath: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxPages: number;
  private readonly onPageFetched: ((event: Readonly<PageFetchedEvent>) => void) | undefined;

  constructor(options: GitHubClientOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    const initial = new URL(this.endpoint);
    this.trustedOrigin = initial.origin;
    this.trustedPath = initial.pathname;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.onPageFetched = options.onPageFetched;
  }

  private buildInitialUrl(): string {
    const url = new URL(this.endpoint);
    url.searchParams.set("state", "open");
    url.searchParams.set("per_page", "100");
    return url.toString();
  }

  private validatePaginationUrl(url: string, page: number): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (error) {
      throw new PaginationError(`Invalid pagination URL: "${url}"`, {
        page,
        url: sanitizeUrl(url),
      });
    }

    if (parsed.protocol !== "https:") {
      throw new PaginationError(
        `Refusing unencrypted pagination URL: protocol must be https: but got "${parsed.protocol}"`,
        { page, url: sanitizeUrl(url) },
      );
    }

    if (parsed.origin !== this.trustedOrigin) {
      throw new PaginationError(
        `Refusing untrusted pagination origin: expected "${this.trustedOrigin}" but got "${parsed.origin}"`,
        { page, url: sanitizeUrl(url) },
      );
    }

    if (parsed.username || parsed.password) {
      throw new PaginationError(
        `Refusing pagination URL containing embedded user credentials`,
        { page, url: sanitizeUrl(url) },
      );
    }

    // GitHub REST API Link headers for pagination may use either the original path
    // (e.g. /repos/owner/repo/pulls) or GitHub's internal repository ID path (e.g. /repositories/:id/pulls).
    const isExpectedPath =
      parsed.pathname === this.trustedPath ||
      (/^\/repositories\/\d+\/pulls$/.test(parsed.pathname) && this.trustedPath.endsWith("/pulls"));

    if (!isExpectedPath) {
      throw new PaginationError(
        `Refusing pagination URL with unexpected path: expected "${this.trustedPath}" but got "${parsed.pathname}"`,
        { page, url: sanitizeUrl(url) },
      );
    }

    if (parsed.hash) {
      throw new PaginationError(
        `Refusing pagination URL containing a fragment`,
        { page, url: sanitizeUrl(url) },
      );
    }

    return parsed;
  }

  async fetchAllOpenPullRequests(): Promise<FetchAllResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const pullRequests: GitHubPullRequest[] = [];
    const seenIds = new Set<number>();
    const visitedUrls = new Set<string>();

    let currentUrl: string | undefined = this.buildInitialUrl();
    let pageCount = 0;
    let latestRateLimit: RateLimitInfo | undefined;

    while (currentUrl) {
      const pageNumber = pageCount + 1;

      if (visitedUrls.has(currentUrl)) {
        throw new PaginationError(
          `Pagination cycle detected: already visited "${sanitizeUrl(currentUrl)}"`,
          { page: pageNumber, url: sanitizeUrl(currentUrl) },
        );
      }

      if (pageCount >= this.maxPages) {
        throw new PaginationError(
          `Pagination exceeded safety limit of ${this.maxPages} pages before processing page ${pageNumber}`,
          { page: pageNumber, url: sanitizeUrl(currentUrl) },
        );
      }

      this.validatePaginationUrl(currentUrl, pageNumber);
      visitedUrls.add(currentUrl);
      pageCount = pageNumber;

      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "qa-backend-challenge-sc/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      const pageStart = Date.now();
      let response: Response;
      try {
        response = await this.fetchImpl(currentUrl, {
          method: "GET",
          headers,
          redirect: "manual", // Reject redirects to protect credentials
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        throw new TransportError(
          `Transport request failed on page ${pageNumber} (${sanitizeUrl(currentUrl)}): ${error instanceof Error ? error.message : String(error)}`,
          { page: pageNumber, url: sanitizeUrl(currentUrl) },
          { cause: error },
        );
      }

      // Check for manual redirect rejection
      if (response.status >= 300 && response.status < 400) {
        throw new HttpError(
          `Unexpected redirect response (status ${response.status}) on page ${pageNumber}. Redirects are rejected for security.`,
          response.status,
          { page: pageNumber, url: sanitizeUrl(currentUrl) },
        );
      }

      // Extract rate limit metadata
      const limitHeader = response.headers.get("x-ratelimit-limit");
      const remainingHeader = response.headers.get("x-ratelimit-remaining");
      const resetHeader = response.headers.get("x-ratelimit-reset");
      const usedHeader = response.headers.get("x-ratelimit-used");

      if (remainingHeader !== null) {
        latestRateLimit = {
          limit: limitHeader ? Number(limitHeader) : undefined,
          remaining: Number(remainingHeader),
          reset: resetHeader ? new Date(Number(resetHeader) * 1000).toISOString() : undefined,
          used: usedHeader ? Number(usedHeader) : undefined,
        };
      }

      if (!response.ok) {
        throw new HttpError(
          `GitHub API responded with HTTP ${response.status} on page ${pageNumber}`,
          response.status,
          {
            page: pageNumber,
            url: sanitizeUrl(currentUrl),
            rateLimitRemaining: latestRateLimit?.remaining,
            rateLimitReset: latestRateLimit?.reset,
          },
        );
      }

      let jsonPayload: unknown;
      try {
        jsonPayload = await response.json();
      } catch (error) {
        throw new SchemaValidationError(
          `Failed to parse JSON response on page ${pageNumber} (${sanitizeUrl(currentUrl)})`,
          { page: pageNumber, url: sanitizeUrl(currentUrl) },
        );
      }

      // Validate page against Zod schema
      const parseResult = githubPullRequestPageSchema.safeParse(jsonPayload);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map(
          (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
        );
        throw new SchemaValidationError(
          `Schema validation failed on page ${pageNumber}: ${issues.join("; ")}`,
          {
            page: pageNumber,
            url: sanitizeUrl(currentUrl),
            zodIssues: issues,
          },
        );
      }

      // Detect duplicate IDs across pages
      for (const pr of parseResult.data) {
        if (seenIds.has(pr.id)) {
          throw new PaginationError(
            `Duplicate pull request id=${pr.id} encountered on page ${pageNumber}`,
            { page: pageNumber, pullRequestId: pr.id, url: sanitizeUrl(currentUrl) },
          );
        }
        seenIds.add(pr.id);
      }

      pullRequests.push(...parseResult.data);

      const pageDuration = Date.now() - pageStart;
      if (this.onPageFetched) {
        try {
          this.onPageFetched({
            pageNumber,
            url: sanitizeUrl(currentUrl),
            itemCount: parseResult.data.length,
            accumulatedCount: pullRequests.length,
            rateLimitRemaining: latestRateLimit?.remaining,
            rateLimitReset: latestRateLimit?.reset,
            durationMs: pageDuration,
          });
        } catch {
          // Callback errors do not compromise data collection
        }
      }

      // Extract next page link from RFC 8288 Link header
      const linkHeader = response.headers.get("link");
      currentUrl = getNextLink(linkHeader);
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    return {
      pullRequests,
      pagesFetched: pageCount,
      recordsReceived: pullRequests.length,
      rateLimit: latestRateLimit,
      startedAt,
      completedAt,
      durationMs,
      isComplete: true,
    };
  }
}
