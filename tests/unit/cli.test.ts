import { describe, expect, it, vi } from "vitest";
import { runShowcase } from "../../src/presentation/cli.js";

// Suppress console output during tests
vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);
vi.spyOn(console, "log").mockImplementation(() => {});

describe("Presentation: CLI exit codes and incomplete state", () => {
  it("returns exitCode 0 and status 'passed' for successful fixture execution", async () => {
    const { exitCode, result } = await runShowcase({ mode: "fixture", format: "json" });

    expect(exitCode).toBe(0);
    expect(result.status).toBe("passed");
    expect(result.contractVersion).toBe("1.0");
    expect(result.collection.paginationComplete).toBe(true);
    expect(result.validation.schemaValid).toBe(true);
  });

  it("returns exitCode 3 and status 'incomplete' for TransportError (network failure)", async () => {
    // Dynamically import to mock the client
    const { GitHubPullRequestClient } = await import("../../src/core/github-client.js");
    const { TransportError } = await import("../../src/core/errors.js");

    const originalFetchAll = GitHubPullRequestClient.prototype.fetchAllOpenPullRequests;
    GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = async function () {
      throw new TransportError("Connection refused", { page: 1 });
    };

    try {
      const { exitCode, result } = await runShowcase({ mode: "fixture", format: "json" });

      expect(exitCode).toBe(3);
      expect(result.status).toBe("incomplete");
      expect(result.collection.paginationComplete).toBe(false);
      expect(result.collection.recordsReceived).toBe(0);
    } finally {
      GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = originalFetchAll;
    }
  });

  it("returns exitCode 4 and status 'incomplete' for SchemaValidationError", async () => {
    const { GitHubPullRequestClient } = await import("../../src/core/github-client.js");
    const { SchemaValidationError } = await import("../../src/core/errors.js");

    const originalFetchAll = GitHubPullRequestClient.prototype.fetchAllOpenPullRequests;
    GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = async function () {
      throw new SchemaValidationError("Invalid schema on page 1", { page: 1 });
    };

    try {
      const { exitCode, result } = await runShowcase({ mode: "fixture", format: "json" });

      expect(exitCode).toBe(4);
      expect(result.status).toBe("incomplete");
    } finally {
      GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = originalFetchAll;
    }
  });

  it("returns exitCode 5 and status 'incomplete' for PaginationError", async () => {
    const { GitHubPullRequestClient } = await import("../../src/core/github-client.js");
    const { PaginationError } = await import("../../src/core/errors.js");

    const originalFetchAll = GitHubPullRequestClient.prototype.fetchAllOpenPullRequests;
    GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = async function () {
      throw new PaginationError("Cycle detected", { page: 3 });
    };

    try {
      const { exitCode, result } = await runShowcase({ mode: "fixture", format: "json" });

      expect(exitCode).toBe(5);
      expect(result.status).toBe("incomplete");
    } finally {
      GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = originalFetchAll;
    }
  });

  it("returns exitCode 3 and status 'incomplete' for HttpError", async () => {
    const { GitHubPullRequestClient } = await import("../../src/core/github-client.js");
    const { HttpError } = await import("../../src/core/errors.js");

    const originalFetchAll = GitHubPullRequestClient.prototype.fetchAllOpenPullRequests;
    GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = async function () {
      throw new HttpError("Rate limit exceeded", 403, { page: 1 });
    };

    try {
      const { exitCode, result } = await runShowcase({ mode: "fixture", format: "json" });

      expect(exitCode).toBe(3);
      expect(result.status).toBe("incomplete");
    } finally {
      GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = originalFetchAll;
    }
  });

  it("emits JSON output to stdout even on error when --format=json", async () => {
    const { GitHubPullRequestClient } = await import("../../src/core/github-client.js");
    const { TransportError } = await import("../../src/core/errors.js");

    const originalFetchAll = GitHubPullRequestClient.prototype.fetchAllOpenPullRequests;
    GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = async function () {
      throw new TransportError("Timeout", { page: 1 });
    };

    const stdoutWrites: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });

    try {
      await runShowcase({ mode: "fixture", format: "json" });

      // stdout should contain exactly one JSON document
      const combined = stdoutWrites.join("");
      expect(() => JSON.parse(combined)).not.toThrow();
      const parsed = JSON.parse(combined);
      expect(parsed.status).toBe("incomplete");
      expect(parsed.contractVersion).toBe("1.0");
    } finally {
      GitHubPullRequestClient.prototype.fetchAllOpenPullRequests = originalFetchAll;
      writeSpy.mockRestore();
    }
  });
});
