import { describe, expect, it, vi } from "vitest";
import { runShowcase } from "../../src/presentation/cli.js";

describe("Presentation: CLI exit codes and incomplete state", () => {
  it("returns exitCode 0 and status 'passed' for successful fixture execution", async () => {
    const stdoutWrites: string[] = [];
    const { exitCode, result } = await runShowcase(
      { mode: "fixture", format: "json" },
      { stdout: (s) => stdoutWrites.push(s) },
    );

    expect(exitCode).toBe(0);
    expect(result.status).toBe("passed");
    expect(result.contractVersion).toBe("1.0");
    expect(result.collection.paginationComplete).toBe(true);
    expect(result.validation.schemaValid).toBe(true);
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
    expect(parsed.contractVersion).toBe("1.0");
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
});
