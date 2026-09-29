import { describe, expect, it } from "vitest";
import { parseEnvironmentConfig } from "../../src/schemas/config.schema.js";
import { ConfigurationError } from "../../src/core/errors.js";

describe("Schemas: config.schema", () => {
  it("parses valid defaults when environment is empty", () => {
    const config = parseEnvironmentConfig({});
    expect(config.GITHUB_TOKEN).toBeUndefined();
    expect(config.GITHUB_TIMEOUT_MS).toBe(10_000);
    expect(config.GITHUB_MAX_PAGES).toBe(20);
  });

  it("parses valid custom environment variables", () => {
    const config = parseEnvironmentConfig({
      GITHUB_TOKEN: "ghp_custom_token",
      GITHUB_TIMEOUT_MS: "15000",
      GITHUB_MAX_PAGES: "50",
    });
    expect(config.GITHUB_TOKEN).toBe("ghp_custom_token");
    expect(config.GITHUB_TIMEOUT_MS).toBe(15_000);
    expect(config.GITHUB_MAX_PAGES).toBe(50);
  });

  it("throws on invalid timeout values", () => {
    expect(() => parseEnvironmentConfig({ GITHUB_TIMEOUT_MS: "100" })).toThrow(
      ConfigurationError,
    );
    expect(() => parseEnvironmentConfig({ GITHUB_TIMEOUT_MS: "not-a-number" })).toThrow(
      ConfigurationError,
    );
  });

  it("throws on invalid max pages values", () => {
    expect(() => parseEnvironmentConfig({ GITHUB_MAX_PAGES: "0" })).toThrow(
      ConfigurationError,
    );
    expect(() => parseEnvironmentConfig({ GITHUB_MAX_PAGES: "9999" })).toThrow(
      ConfigurationError,
    );
  });
});
