import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mainTsPath = path.resolve(__dirname, "../../src/presentation/main.ts");
const distMainPath = path.resolve(__dirname, "../../dist/presentation/main.js");

function getCleanEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "test",
    ...overrides,
  };
}

describe("CLI E2E: main execution and environment isolation", () => {
  it(
    "emits contractVersion 1.2 error JSON with exitCode 2 on invalid CLI options",
    () => {
      const result = spawnSync(
        "npx",
        ["tsx", mainTsPath, "--mode=lvie", "--format", "json"],
        {
          env: getCleanEnv(),
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).toBe(2);
      expect(result.stdout).toBeDefined();

      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.contractVersion).toBe("1.2");
      expect(parsed.mode).toBe("fixture");
      expect(parsed.status).toBe("incomplete");
      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe("CONFIGURATION_ERROR");
      expect(parsed.error.message).toContain("lvie");
      expect(parsed.validation.schemaValid).toBeNull();
      expect(parsed.validation.aggregateValid).toBeNull();

      const expectedKeys = [
        "contractVersion",
        "mode",
        "status",
        "error",
        "source",
        "collection",
        "validation",
        "durationMs",
        "limitations",
      ];
      expect(Object.keys(parsed).sort()).toEqual(expectedKeys.sort());
    },
    30000,
  );

  it(
    "executes fixture mode successfully with exitCode 0 and valid JSON",
    () => {
      const result = spawnSync(
        "npx",
        ["tsx", mainTsPath, "--mode=fixture", "--format=json"],
        {
          env: getCleanEnv(),
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.contractVersion).toBe("1.2");
      expect(parsed.mode).toBe("fixture");
      expect(parsed.status).toBe("passed");
      expect(parsed.validation.schemaValid).toBe(true);
      expect(parsed.validation.aggregateValid).toBe(true);
      expect(parsed.collection.recordsReceived).toBe(6);
      expect(parsed.collection.uniqueRecords).toBe(6);
      expect(parsed.collection.openNonDraftRecords).toBe(4);
      expect(parsed.collection.draftRecords).toBe(2);
      expect(parsed.collection.duplicatesSkipped).toBe(0);
      expect(parsed.collection.paginationComplete).toBe(true);
    },
    30000,
  );

  it(
    "isolates offline test execution from inherited hostile host environment",
    () => {
      const oldMaxPages = process.env.GITHUB_MAX_PAGES;
      const oldTolerance = process.env.LIVE_TOLERANCE;
      try {
        process.env.GITHUB_MAX_PAGES = "1";
        process.env.LIVE_TOLERANCE = "invalid-tolerance";

        const result = spawnSync(
          "npx",
          ["tsx", mainTsPath, "--mode=fixture", "--format=json"],
          {
            env: getCleanEnv(),
            encoding: "utf-8",
            timeout: 30000,
          },
        );

        expect(result.status).toBe(0);
        const parsed = JSON.parse(result.stdout.trim());
        expect(parsed.status).toBe("passed");
        expect(parsed.collection.pagesFetched).toBe(3);
      } finally {
        if (oldMaxPages === undefined) delete process.env.GITHUB_MAX_PAGES;
        else process.env.GITHUB_MAX_PAGES = oldMaxPages;
        if (oldTolerance === undefined) delete process.env.LIVE_TOLERANCE;
        else process.env.LIVE_TOLERANCE = oldTolerance;
      }
    },
    30000,
  );

  it(
    "fails loud with exitCode 2 when hostile configuration is intentionally supplied",
    () => {
      const resultMaxPages = spawnSync(
        "npx",
        ["tsx", mainTsPath, "--mode=fixture", "--format=json"],
        {
          env: getCleanEnv({ GITHUB_MAX_PAGES: "0" }),
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(resultMaxPages.status).toBe(2);
      const parsedMaxPages = JSON.parse(resultMaxPages.stdout.trim());
      expect(parsedMaxPages.error?.code).toBe("CONFIGURATION_ERROR");

      const resultTolerance = spawnSync(
        "npx",
        ["tsx", mainTsPath, "--mode=fixture", "--format=json"],
        {
          env: getCleanEnv({ LIVE_TOLERANCE: "abc" }),
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(resultTolerance.status).toBe(2);
      const parsedTolerance = JSON.parse(resultTolerance.stdout.trim());
      expect(parsedTolerance.error?.code).toBe("CONFIGURATION_ERROR");
    },
    30000,
  );

  it(
    "executes compiled CLI (dist/presentation/main.js) with clean machine-readable JSON",
    () => {
      // Build first if dist doesn't exist
      spawnSync("npm", ["run", "build"], { encoding: "utf-8", timeout: 30000 });

      const result = spawnSync(
        "node",
        [distMainPath, "--format=json"],
        {
          env: getCleanEnv(),
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).toBe(0);
      expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.contractVersion).toBe("1.2");
      expect(parsed.status).toBe("passed");
      expect(parsed.collection.openNonDraftRecords).toBe(4);
    },
    30000,
  );
});
