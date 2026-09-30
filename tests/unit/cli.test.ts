import { describe, expect, it, vi } from "vitest";
import {
  parseCliArgs,
  runShowcase,
  mapErrorToExitCode,
  detectRequestedOutput,
  describeError,
  buildErrorResult,
} from "../../src/presentation/cli.js";
import {
  ConfigurationError,
  TransportError,
  HttpError,
  SchemaValidationError,
  PaginationError,
  QaChallengeError,
} from "../../src/core/errors.js";
import { AggregateRuleError } from "../../src/business/aggregate-rules.js";

describe("Presentation: CLI exit codes and error mapping", () => {
  it("maps error classes to corresponding exit codes", () => {
    expect(mapErrorToExitCode(new ConfigurationError("bad config"))).toBe(2);
    expect(mapErrorToExitCode(new TransportError("offline"))).toBe(3);
    expect(mapErrorToExitCode(new HttpError("not found", 404))).toBe(3);
    expect(mapErrorToExitCode(new SchemaValidationError("invalid json"))).toBe(4);
    expect(mapErrorToExitCode(new PaginationError("cycle"))).toBe(5);
    expect(mapErrorToExitCode(new AggregateRuleError("violation", []))).toBe(1);
    expect(mapErrorToExitCode(new QaChallengeError("BUSINESS_RULE_VIOLATION", "error"))).toBe(1);
    expect(mapErrorToExitCode(new Error("generic"))).toBe(6);
    expect(mapErrorToExitCode(new TypeError("undefined is not a function"))).toBe(6);
  });

  it("parses valid CLI options correctly", () => {
    expect(parseCliArgs([])).toEqual({ mode: "fixture", format: "human" });
    expect(parseCliArgs(["--mode=live", "--format=json"])).toEqual({
      mode: "live",
      format: "json",
    });
  });

  it("throws ConfigurationError on unknown or invalid CLI options", () => {
    expect(() => parseCliArgs(["--mode=lvie"])).toThrow(ConfigurationError);
    expect(() => parseCliArgs(["--format=xml"])).toThrow(ConfigurationError);
    expect(() => parseCliArgs(["--unknown-flag"])).toThrow(ConfigurationError);
  });

  it("returns exitCode 0 and status 'passed' for successful fixture execution", async () => {
    const stdoutWrites: string[] = [];
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      { stdout: (s) => stdoutWrites.push(s) },
    );

    expect(exitCode).toBe(0);
    expect(result.status).toBe("passed");
    expect(result.contractVersion).toBe("1.1");
    expect(result.collection.paginationComplete).toBe(true);
    expect(result.validation.schemaValid).toBe(true);
  });

  it("returns exitCode 2 and valid JSON on stdout when environment configuration is invalid", async () => {
    const stdoutWrites: string[] = [];
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        env: { GITHUB_MAX_PAGES: "0" },
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(2);
    expect(result.status).toBe("incomplete");
    expect(result.error?.code).toBe("CONFIGURATION_ERROR");
    expect(result.validation.schemaValid).toBeNull();
    expect(result.validation.aggregateValid).toBeNull();
    const combined = stdoutWrites.join("");
    expect(() => JSON.parse(combined)).not.toThrow();
  });

  it("returns exitCode 3 and status 'incomplete' for TransportError (network failure)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const stdoutWrites: string[] = [];

    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(3);
    expect(result.status).toBe("incomplete");
    expect(result.error?.code).toBe("TRANSPORT_ERROR");
    expect(result.validation.schemaValid).toBeNull();
    expect(result.validation.aggregateValid).toBeNull();
    expect(result.collection.paginationComplete).toBe(false);
    expect(result.collection.recordsReceived).toBe(0);
  });

  it("returns exitCode 4 and status 'incomplete' for SchemaValidationError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ invalid: true }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: () => {},
      },
    );

    expect(exitCode).toBe(4);
    expect(result.status).toBe("incomplete");
    expect(result.error?.code).toBe("SCHEMA_VALIDATION_ERROR");
    expect(result.validation.schemaValid).toBe(false);
    expect(result.validation.aggregateValid).toBeNull();
  });

  it("returns exitCode 4 and preserves Part 1 metrics when Part 2 schema is invalid", async () => {
    const stdoutWrites: string[] = [];
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        canonicalAggregate: { invalid: true },
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(4);
    expect(result.status).toBe("incomplete");
    expect(result.error?.code).toBe("SCHEMA_VALIDATION_ERROR");
    expect(result.validation.schemaValid).toBe(false);
    expect(result.validation.aggregateValid).toBeNull();
    expect(result.collection.pagesFetched).toBe(3);
    expect(result.collection.recordsReceived).toBe(6);
    expect(result.collection.openNonDraftRecords).toBe(4);
    expect(result.collection.draftRecords).toBe(2);
    expect(result.collection.paginationComplete).toBe(true);
  });

  it("returns exitCode 5 and status 'incomplete' for PaginationError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: [
            '<https://api.github.com/repos/appwrite/appwrite/pulls?page=2>; rel="next"',
            '<https://api.github.com/repos/appwrite/appwrite/pulls?page=3>; rel="next"',
          ].join(", "),
        },
      }),
    );

    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: () => {},
      },
    );

    expect(exitCode).toBe(5);
    expect(result.status).toBe("incomplete");
    expect(result.error?.code).toBe("PAGINATION_ERROR");
    expect(result.validation.schemaValid).toBeNull();
  });

  it("returns exitCode 3 and status 'incomplete' for HttpError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("Rate limit exceeded", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      }),
    );

    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: () => {},
      },
    );

    expect(exitCode).toBe(3);
    expect(result.status).toBe("incomplete");
    expect(result.error?.code).toBe("HTTP_ERROR");
    expect(result.validation.schemaValid).toBeNull();
  });

  it("preserves pagesFetched: 2 and recordsReceived: 4 when error occurs on page 3", async () => {
    const { page1Fixture, page2Fixture } = await import("../../src/demo/fixtures/github-pulls-pages.js");
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page");
      if (page === null || page === "1") {
        return new Response(JSON.stringify(page1Fixture), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=2>; rel="next"',
          },
        });
      }
      if (page === "2") {
        return new Response(JSON.stringify(page2Fixture), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=3>; rel="next"',
          },
        });
      }
      return new Response("Internal Server Error", { status: 500 });
    });

    const stdoutWrites: string[] = [];
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(3);
    expect(result.status).toBe("incomplete");
    expect(result.collection.pagesFetched).toBe(2);
    expect(result.collection.recordsReceived).toBe(4);
    expect(result.error?.page).toBe(3);
    expect(result.error?.code).toBe("HTTP_ERROR");
    expect(result.validation.schemaValid).toBeNull();
  });

  it("emits JSON output to stdout even on error when --format=json", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Timeout"));
    const stdoutWrites: string[] = [];

    await runShowcase(
      { mode: "fixture", format: "json" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    const combined = stdoutWrites.join("");
    expect(() => JSON.parse(combined)).not.toThrow();
    const parsed = JSON.parse(combined);
    expect(parsed.status).toBe("incomplete");
    expect(parsed.contractVersion).toBe("1.1");
  });

  it("renders human output correctly in non-json mode", async () => {
    const stdoutWrites: string[] = [];
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "human" },
      { stdout: (s) => stdoutWrites.push(s) },
    );

    expect(exitCode).toBe(0);
    expect(result.status).toBe("passed");
    const combined = stdoutWrites.join("");
    expect(combined).toContain("QA BACKEND TECHNICAL CHALLENGE");
    expect(combined).toContain("ALL REQUIREMENTS SATISFIED");
  });

  it("renders human error output on failure", async () => {
    const stdoutWrites: string[] = [];
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Simulated failure"));

    const { exitCode } = await runShowcase(
      { mode: "fixture", format: "human" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(3);
    const combined = stdoutWrites.join("");
    expect(combined).toContain("ERROR");
    expect(combined).toContain("Simulated failure");
  });

  it("fails with status 'failed' and exitCode 1 when canonical aggregate has rule violations", async () => {
    const stdoutWrites: string[] = [];
    const { sampleAggregateResponse } = await import("../../src/demo/fixtures/aggregate-response.js");
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        canonicalAggregate: { ...sampleAggregateResponse, total_open_prs: 5 },
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(1);
    expect(result.status).toBe("failed");
    expect(result.validation.aggregateValid).toBe(false);
    expect(result.validation.violations[0]?.code).toBe("PR_COUNT_MISMATCH");
  });

  it("renders [FAIL] and violation message for Rule 1 when PR count mismatches in human mode", async () => {
    const stdoutWrites: string[] = [];
    const { sampleAggregateResponse } = await import("../../src/demo/fixtures/aggregate-response.js");
    const { exitCode } = await runShowcase(
      { mode: "fixture", format: "human" },
      {
        canonicalAggregate: { ...sampleAggregateResponse, total_open_prs: 5 },
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(1);
    const combined = stdoutWrites.join("");
    expect(combined).toMatch(/Rule 1.*FAIL/);
    expect(combined).not.toMatch(/Rule 1.*PASS/);
    expect(combined).toMatch(/\[Violation\].*expected total_open_prs=5.*contains 1 item\(s\)/);
  });

  it("fails with status 'failed' and exitCode 1 when simulation does not detect expected violation", async () => {
    const stdoutWrites: string[] = [];
    const { sampleAggregateResponse } = await import("../../src/demo/fixtures/aggregate-response.js");
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        simulationAggregate: sampleAggregateResponse,
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(1);
    expect(result.status).toBe("failed");
    expect(result.validation.simulation?.detected).toBe(false);
  });

  it("returns contractVersion 1.1 with simulation info on happy path", async () => {
    const stdoutWrites: string[] = [];
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      { stdout: (s) => stdoutWrites.push(s) },
    );

    expect(exitCode).toBe(0);
    expect(result.status).toBe("passed");
    expect(result.contractVersion).toBe("1.1");
    expect(result.validation.simulation).toEqual({
      expectedViolation: "HIGH_PRIORITY_PR_IS_DRAFT",
      detected: true,
    });
  });

  it("runs showcase with default stdout, stderr, and now dependencies", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const { exitCode, result } = await runShowcase({ mode: "fixture", format: "json" });
      expect(exitCode).toBe(0);
      expect(result.status).toBe("passed");
      expect(stdoutSpy).toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("runs showcase in human mode with default stdout and stderr dependencies", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const { exitCode, result } = await runShowcase({ mode: "fixture", format: "human" });
      expect(exitCode).toBe(0);
      expect(result.status).toBe("passed");
      expect(stdoutSpy).toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("returns exitCode 4 when simulationAggregate schema is invalid", async () => {
    const stdoutWrites: string[] = [];
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      {
        simulationAggregate: { invalid: true },
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(4);
    expect(result.status).toBe("incomplete");
    expect(result.error?.code).toBe("SCHEMA_VALIDATION_ERROR");
  });

  it("renders VIOLATION NOT DETECTED badge in human mode when simulation violation is not caught", async () => {
    const stdoutWrites: string[] = [];
    const { sampleAggregateResponse } = await import("../../src/demo/fixtures/aggregate-response.js");
    const { exitCode } = await runShowcase(
      { mode: "fixture", format: "human" },
      {
        simulationAggregate: sampleAggregateResponse,
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(1);
    const combined = stdoutWrites.join("");
    expect(combined).toContain("VIOLATION NOT DETECTED");
  });

  it("renders duplicates skipped notice in human mode when duplicates occur", async () => {
    const { page1Fixture } = await import("../../src/demo/fixtures/github-pulls-pages.js");
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page");
      if (page === null || page === "1") {
        return new Response(JSON.stringify(page1Fixture), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&page=2>; rel="next"',
          },
        });
      }
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const stdoutWrites: string[] = [];
    const { exitCode } = await runShowcase(
      { mode: "fixture", format: "human" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: (s) => stdoutWrites.push(s),
      },
    );

    expect(exitCode).toBe(0);
    const combined = stdoutWrites.join("");
    expect(combined).toContain("Duplicates Skipped");
  });
});

describe("Presentation: detectRequestedOutput", () => {
  it("defaults to format=human and mode=fixture when no arguments are provided", () => {
    expect(detectRequestedOutput([])).toEqual({ format: "human", mode: "fixture" });
    expect(detectRequestedOutput(["--unknown"])).toEqual({ format: "human", mode: "fixture" });
  });

  it("parses equal-separated options --format=json and --mode=live", () => {
    expect(detectRequestedOutput(["--format=json"])).toEqual({ format: "json", mode: "fixture" });
    expect(detectRequestedOutput(["--mode=live"])).toEqual({ format: "human", mode: "live" });
    expect(detectRequestedOutput(["--mode=live", "--format=json"])).toEqual({ format: "json", mode: "live" });
    expect(detectRequestedOutput(["--format=human", "--mode=fixture"])).toEqual({ format: "human", mode: "fixture" });
  });

  it("parses space-separated options --format json and --mode live", () => {
    expect(detectRequestedOutput(["--format", "json"])).toEqual({ format: "json", mode: "fixture" });
    expect(detectRequestedOutput(["--mode", "live"])).toEqual({ format: "human", mode: "live" });
    expect(detectRequestedOutput(["--mode", "live", "--format", "json"])).toEqual({ format: "json", mode: "live" });
    expect(detectRequestedOutput(["--format", "human", "--mode", "fixture"])).toEqual({ format: "human", mode: "fixture" });
  });

  it("ignores trailing flags without values or invalid flag values", () => {
    expect(detectRequestedOutput(["--format"])).toEqual({ format: "human", mode: "fixture" });
    expect(detectRequestedOutput(["--mode"])).toEqual({ format: "human", mode: "fixture" });
    expect(detectRequestedOutput(["--format=yaml", "--mode=foo"])).toEqual({ format: "human", mode: "fixture" });
  });
});

describe("Presentation: describeError", () => {
  it("extracts error code, message, and page from QaChallengeError", () => {
    const errorWithPage = new PaginationError("cycle detected", { page: 3 });
    expect(describeError(errorWithPage)).toEqual({
      code: "PAGINATION_ERROR",
      message: "cycle detected",
      page: 3,
    });

    const errorWithoutPage = new ConfigurationError("missing token");
    expect(describeError(errorWithoutPage)).toEqual({
      code: "CONFIGURATION_ERROR",
      message: "missing token",
    });
  });

  it("extracts name and message from standard Error instances", () => {
    const typeError = new TypeError("null is not an object");
    expect(describeError(typeError)).toEqual({
      code: "TypeError",
      message: "null is not an object",
    });

    const standardError = new Error("something went wrong");
    expect(describeError(standardError)).toEqual({
      code: "Error",
      message: "something went wrong",
    });
  });

  it("handles non-Error objects and primitive values gracefully", () => {
    expect(describeError("string error")).toEqual({
      code: "UNKNOWN_ERROR",
      message: "string error",
    });

    expect(describeError({ code: 123 })).toEqual({
      code: "UNKNOWN_ERROR",
      message: "[object Object]",
    });

    expect(describeError(null)).toEqual({
      code: "UNKNOWN_ERROR",
      message: "null",
    });
  });
});

describe("Presentation: buildErrorResult", () => {
  it("builds a fallback RunResult with default fields and null validation states", () => {
    const errorDetails = { code: "CONFIGURATION_ERROR", message: "invalid flag" };
    const result = buildErrorResult({
      mode: "fixture",
      error: errorDetails,
      observedFrom: "2026-09-30T00:00:00.000Z",
      observedTo: "2026-09-30T00:00:00.010Z",
      durationMs: 10,
    });

    expect(result.contractVersion).toBe("1.1");
    expect(result.mode).toBe("fixture");
    expect(result.status).toBe("incomplete");
    expect(result.error).toEqual(errorDetails);
    expect(result.source.fixtureName).toBe("multi-page-deterministic-fixture");
    expect(result.collection.pagesFetched).toBe(0);
    expect(result.collection.recordsReceived).toBe(0);
    expect(result.collection.paginationComplete).toBe(false);
    expect(result.validation.schemaValid).toBeNull();
    expect(result.validation.aggregateValid).toBeNull();
    expect(result.validation.violations).toEqual([]);
    expect(result.durationMs).toBe(10);
  });

  it("builds a fallback RunResult preserving partial collection metrics", () => {
    const errorDetails = { code: "HTTP_ERROR", message: "500 Internal Error", page: 3 };
    const result = buildErrorResult({
      mode: "live",
      error: errorDetails,
      observedFrom: "2026-09-30T00:00:00.000Z",
      observedTo: "2026-09-30T00:00:00.050Z",
      durationMs: 50,
      partial: {
        pagesFetched: 2,
        recordsReceived: 200,
        duplicatesSkipped: 1,
        draftRecords: 10,
        openNonDraftRecords: 190,
        paginationComplete: false,
        schemaValid: true,
      },
    });

    expect(result.mode).toBe("live");
    expect(result.source.fixtureName).toBeUndefined();
    expect(result.collection.pagesFetched).toBe(2);
    expect(result.collection.recordsReceived).toBe(200);
    expect(result.collection.duplicatesSkipped).toBe(1);
    expect(result.collection.draftRecords).toBe(10);
    expect(result.collection.openNonDraftRecords).toBe(190);
    expect(result.collection.paginationComplete).toBe(false);
    expect(result.validation.schemaValid).toBe(true);
    expect(result.validation.aggregateValid).toBeNull();
  });
});

