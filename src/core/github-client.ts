import {
  githubPullRequestPageSchema,
  type GitHubPullRequest,
} from "../schemas/github-pull.schema.js";
import { resolveNextLink } from "./link-header.js";
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
  readonly recordsReceived: number;
  readonly uniqueRecords: number;
  readonly accumulatedCount?: number | undefined;
  readonly duplicatesSkipped: number;
  readonly draftRecords: number;
  readonly openNonDraftRecords: number;
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
  readonly uniqueRecords: number;
  readonly duplicatesSkipped: number;
  readonly draftRecords: number;
  readonly openNonDraftRecords: number;
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

function parseRateLimitNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const num = Number(value);
  return Number.isFinite(num) && !Number.isNaN(num) && num >= 0 ? num : undefined;
}

function parseRateLimitReset(value: string | null): string | undefined {
  if (value === null) return undefined;
  const num = Number(value);
  // Epoch seconds range check: year 2000 (946684800) to year 3000 (32503680000)
  if (!Number.isFinite(num) || Number.isNaN(num) || num < 946684800 || num > 32503680000) {
    return undefined;
  }
  try {
    return new Date(num * 1000).toISOString();
  } catch {
    return undefined;
  }
}

export class GitHubPullRequestClient {
  private readonly endpoint: string;
  private readonly trustedOrigin: string;
  private readonly trustedPath: string;
  private readonly expectedOwnerRepo: string | undefined;
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

    const repoPathMatch = this.trustedPath.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls$/);
    this.expectedOwnerRepo = repoPathMatch
      ? `${repoPathMatch[1]}/${repoPathMatch[2]}`.toLowerCase()
      : undefined;

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
    url.searchParams.set("sort", "created");
    url.searchParams.set("direction", "asc");
    return url.toString();
  }

  private validatePaginationUrl(
    url: string,
    page: number,
    confirmedRepoId: string | undefined,
  ): { parsed: URL; repoId?: string | undefined } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new PaginationError(`Invalid pagination URL: "${url}"`, {
        page,
        url: sanitizeUrl(url),
      });
    }

    const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !isLoopback) {
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

    if (parsed.hash) {
      throw new PaginationError(
        `Refusing pagination URL containing a fragment`,
        { page, url: sanitizeUrl(url) },
      );
    }

    // Check for contradictory / duplicate query parameters
    const semanticKeys = ["state", "per_page", "sort", "direction", "page"] as const;
    for (const key of semanticKeys) {
      const values = parsed.searchParams.getAll(key);
      if (values.length > 1) {
        throw new PaginationError(
          `Refusing pagination URL with duplicate "${key}" query parameter: [${values.join(", ")}]`,
          { page, url: sanitizeUrl(url) },
        );
      }
    }

    // Enforce query parameter invariants defining dataset and order
    const state = parsed.searchParams.get("state");
    if (state !== "open") {
      throw new PaginationError(
        `Refusing pagination URL with invalid or missing "state" parameter: expected "open" but got "${state ?? "missing"}"`,
        { page, url: sanitizeUrl(url) },
      );
    }

    const sort = parsed.searchParams.get("sort");
    if (sort !== "created") {
      throw new PaginationError(
        `Refusing pagination URL with invalid or missing "sort" parameter: expected "created" but got "${sort ?? "missing"}"`,
        { page, url: sanitizeUrl(url) },
      );
    }

    const direction = parsed.searchParams.get("direction");
    if (direction !== "asc") {
      throw new PaginationError(
        `Refusing pagination URL with invalid or missing "direction" parameter: expected "asc" but got "${direction ?? "missing"}"`,
        { page, url: sanitizeUrl(url) },
      );
    }

    const perPage = parsed.searchParams.get("per_page");
    if (perPage !== "100") {
      throw new PaginationError(
        `Refusing pagination URL with invalid or missing "per_page" parameter: expected "100" but got "${perPage ?? "missing"}"`,
        { page, url: sanitizeUrl(url) },
      );
    }

    const pageParam = parsed.searchParams.get("page");
    if (pageParam !== null && (!/^\d+$/.test(pageParam) || Number(pageParam) <= 0)) {
      throw new PaginationError(
        `Refusing pagination URL with invalid "page" parameter: "${pageParam}"`,
        { page, url: sanitizeUrl(url) },
      );
    }

    // Path verification: original path or internal GitHub numeric repository ID path
    const repoMatch = parsed.pathname.match(/^\/repositories\/(\d+)\/pulls$/);
    const isRepoIdPath = repoMatch !== null && this.trustedPath.endsWith("/pulls");
    const isOriginalPath = parsed.pathname === this.trustedPath;

    if (!isOriginalPath && !isRepoIdPath) {
      throw new PaginationError(
        `Refusing pagination URL with unexpected path: expected "${this.trustedPath}" but got "${parsed.pathname}"`,
        { page, url: sanitizeUrl(url) },
      );
    }

    const repoId = repoMatch?.[1];
    if (repoId !== undefined) {
      // Must be validated against the confirmed repository identity from the target repository
      if (confirmedRepoId === undefined) {
        throw new PaginationError(
          `Refusing unverified numeric repository pagination URL: repository ID "${repoId}" cannot be verified against target repository "${this.expectedOwnerRepo ?? this.trustedPath}"`,
          { page, url: sanitizeUrl(url) },
        );
      }
      if (repoId !== confirmedRepoId) {
        throw new PaginationError(
          `Refusing pagination URL with mismatched repository ID: expected "${confirmedRepoId}" but got "${repoId}"`,
          { page, url: sanitizeUrl(url) },
        );
      }
    }

    return { parsed, repoId };
  }

  async fetchAllOpenPullRequests(): Promise<FetchAllResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const pullRequests: GitHubPullRequest[] = [];
    const seenIds = new Set<number>();
    const visitedUrls = new Set<string>();

    let currentUrl: string | undefined = this.buildInitialUrl();
    let pageCount = 0;
    let totalRecordsReceived = 0;
    let duplicatesSkipped = 0;
    let latestRateLimit: RateLimitInfo | undefined;
    let confirmedRepoId: string | undefined;

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

      this.validatePaginationUrl(currentUrl, pageNumber, confirmedRepoId);
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

      // Extract rate limit metadata with resilience against malformed headers
      const limitHeader = response.headers.get("x-ratelimit-limit");
      const remainingHeader = response.headers.get("x-ratelimit-remaining");
      const resetHeader = response.headers.get("x-ratelimit-reset");
      const usedHeader = response.headers.get("x-ratelimit-used");

      const remainingNum = parseRateLimitNumber(remainingHeader);
      if (remainingNum !== undefined) {
        latestRateLimit = {
          limit: parseRateLimitNumber(limitHeader),
          remaining: remainingNum,
          reset: parseRateLimitReset(resetHeader),
          used: parseRateLimitNumber(usedHeader),
        };
      }

      // Read response body as raw text with transport error handling
      let rawBody: string;
      try {
        rawBody = await response.text();
      } catch (error) {
        throw new TransportError(
          `Failed to read response body on page ${pageNumber} (${sanitizeUrl(currentUrl)}): ${error instanceof Error ? error.message : String(error)}`,
          { page: pageNumber, url: sanitizeUrl(currentUrl) },
          { cause: error },
        );
      }

      if (!response.ok) {
        const responseBodySnippet = rawBody ? rawBody.slice(0, 200).trim() : "";
        let message = `GitHub API responded with HTTP ${response.status} on page ${pageNumber}`;
        if (responseBodySnippet) {
          message += `: ${responseBodySnippet}`;
        }
        if (
          (response.status === 403 || response.status === 429) &&
          latestRateLimit?.remaining === 0 &&
          latestRateLimit.reset
        ) {
          message += ` (rate limit reset: ${latestRateLimit.reset})`;
        }

        throw new HttpError(
          message,
          response.status,
          {
            page: pageNumber,
            url: sanitizeUrl(currentUrl),
            rateLimitRemaining: latestRateLimit?.remaining,
            rateLimitReset: latestRateLimit?.reset,
            ...(responseBodySnippet ? { responseBody: responseBodySnippet } : {}),
          },
        );
      }

      // Parse JSON from successfully received body
      let jsonPayload: unknown;
      try {
        jsonPayload = JSON.parse(rawBody);
      } catch (error) {
        throw new SchemaValidationError(
          `Failed to parse JSON response on page ${pageNumber} (${sanitizeUrl(currentUrl)}): ${error instanceof Error ? error.message : String(error)}`,
          { page: pageNumber, url: sanitizeUrl(currentUrl) },
          { cause: error },
        );
      }

      // Validate page against Zod wire schema
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

      // Validate base repository identity against expected target repository
      for (const pr of parseResult.data) {
        if (pr.base?.repo) {
          const baseFullName = pr.base.repo.full_name?.toLowerCase();
          if (this.expectedOwnerRepo && baseFullName && baseFullName !== this.expectedOwnerRepo) {
            throw new PaginationError(
              `Pull request base repository "${pr.base.repo.full_name}" does not match target repository "${this.expectedOwnerRepo}" on page ${pageNumber}`,
              { page: pageNumber, url: sanitizeUrl(currentUrl) },
            );
          }
          if (confirmedRepoId === undefined && pr.base.repo.id) {
            confirmedRepoId = pr.base.repo.id.toString();
          }
        }
      }

      // 1. Detect duplicate IDs within the same page (API defect)
      const pageIds = new Set<number>();
      for (const pr of parseResult.data) {
        if (pageIds.has(pr.id)) {
          throw new PaginationError(
            `Duplicate pull request id=${pr.id} encountered within page ${pageNumber}`,
            { page: pageNumber, pullRequestId: pr.id, url: sanitizeUrl(currentUrl) },
          );
        }
        pageIds.add(pr.id);
      }

      // Page is accepted: update cumulative records received
      totalRecordsReceived += parseResult.data.length;

      // 2. Handle duplicates across pages (shifted records deduplicated)
      for (const pr of parseResult.data) {
        if (seenIds.has(pr.id)) {
          duplicatesSkipped += 1;
        } else {
          seenIds.add(pr.id);
          pullRequests.push(pr);
        }
      }

      const uniqueDraftCount = pullRequests.filter((pr) => pr.draft).length;
      const uniqueOpenNonDraftCount = pullRequests.filter((pr) => pr.state === "open" && !pr.draft).length;

      const pageDuration = Date.now() - pageStart;
      if (this.onPageFetched) {
        try {
          this.onPageFetched({
            pageNumber,
            url: sanitizeUrl(currentUrl),
            itemCount: parseResult.data.length,
            recordsReceived: totalRecordsReceived,
            uniqueRecords: pullRequests.length,
            accumulatedCount: pullRequests.length,
            duplicatesSkipped,
            draftRecords: uniqueDraftCount,
            openNonDraftRecords: uniqueOpenNonDraftCount,
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
      const resolvedNext = resolveNextLink(linkHeader, currentUrl);
      if (resolvedNext.kind === "ambiguous") {
        throw new PaginationError(
          `Ambiguous Link header: ${resolvedNext.urls.length} distinct rel=next targets on page ${pageNumber}`,
          { page: pageNumber, url: sanitizeUrl(currentUrl) },
        );
      }
      if (resolvedNext.kind === "malformed") {
        throw new PaginationError(
          `Malformed Link header on page ${pageNumber}: ${resolvedNext.error}`,
          { page: pageNumber, url: sanitizeUrl(currentUrl) },
        );
      }

      currentUrl = resolvedNext.kind === "next" ? resolvedNext.url : undefined;
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;
    const draftRecords = pullRequests.filter((pr) => pr.draft).length;
    const openNonDraftRecords = pullRequests.filter((pr) => pr.state === "open" && !pr.draft).length;

    return {
      pullRequests,
      pagesFetched: pageCount,
      recordsReceived: totalRecordsReceived,
      uniqueRecords: pullRequests.length,
      duplicatesSkipped,
      draftRecords,
      openNonDraftRecords,
      rateLimit: latestRateLimit,
      startedAt,
      completedAt,
      durationMs,
      isComplete: true,
    };
  }
}
