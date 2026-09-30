import { parseCliArgs, runShowcase, mapErrorToExitCode } from "./cli.js";
import { buildRunResult } from "./presentation-model.js";
import { QaChallengeError, ConfigurationError } from "../core/errors.js";

async function main(): Promise<void> {
  let format: "human" | "json" = "human";
  try {
    const args = parseCliArgs(process.argv.slice(2));
    format = args.format;
    const { exitCode } = await runShowcase(args);
    process.exit(exitCode);
  } catch (error) {
    const exitCode = mapErrorToExitCode(error);
    const rawArgs = process.argv.slice(2);
    const wantsJson =
      format === "json" ||
      rawArgs.includes("--format=json") ||
      rawArgs.some((arg) => arg.startsWith("--format=json"));

    if (wantsJson) {
      const modeArg = rawArgs.find((arg) => arg.startsWith("--mode="));
      const modeValue = modeArg ? modeArg.slice("--mode=".length) : undefined;
      const mode: "fixture" | "live" = modeValue === "live" ? "live" : "fixture";
      const nowIso = new Date().toISOString();

      let errorCode = "UNEXPECTED_ERROR";
      if (error instanceof ConfigurationError) {
        errorCode = "CONFIGURATION_ERROR";
      } else if (error instanceof QaChallengeError) {
        errorCode = error.code;
      } else if (error instanceof Error) {
        errorCode = error.name;
      }

      const fallbackResult = buildRunResult({
        mode,
        status: "incomplete",
        error: {
          code: errorCode,
          message: error instanceof Error ? error.message : String(error),
        },
        observedFrom: nowIso,
        observedTo: nowIso,
        fixtureName: mode === "fixture" ? "multi-page-deterministic-fixture" : undefined,
        pagesFetched: 0,
        recordsReceived: 0,
        duplicatesSkipped: 0,
        draftRecords: 0,
        openNonDraftRecords: 0,
        paginationComplete: false,
        schemaValid: null,
        aggregateValid: false,
        violations: [],
        durationMs: 0,
      });

      console.log(`${JSON.stringify(fallbackResult, null, 2)}\n`);
    } else {
      console.error(
        "\nShowcase execution encountered an error:",
        error instanceof Error ? error.message : String(error),
      );
    }
    process.exit(exitCode);
  }
}

void main();
