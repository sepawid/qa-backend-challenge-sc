import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("CLI E2E: main.ts execution", () => {
  it(
    "emits contractVersion 1.1 error JSON with exitCode 2 on invalid CLI options",
    () => {
      const mainPath = path.resolve(__dirname, "../../src/presentation/main.ts");
      const result = spawnSync(
        "npx",
        ["tsx", mainPath, "--mode=lvie", "--format", "json"],
        {
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).toBe(2);
      expect(result.stdout).toBeDefined();

      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.contractVersion).toBe("1.1");
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
      const mainPath = path.resolve(__dirname, "../../src/presentation/main.ts");
      const result = spawnSync(
        "npx",
        ["tsx", mainPath, "--mode=fixture", "--format=json"],
        {
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.contractVersion).toBe("1.1");
      expect(parsed.mode).toBe("fixture");
      expect(parsed.status).toBe("passed");
      expect(parsed.validation.schemaValid).toBe(true);
      expect(parsed.validation.aggregateValid).toBe(true);
      expect(parsed.collection.openNonDraftRecords).toBe(4);
    },
    30000,
  );
});
