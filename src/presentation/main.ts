import { parseCliArgs, runShowcase, mapErrorToExitCode } from "./cli.js";
import { ConfigurationError } from "../core/errors.js";

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
      console.log(
        JSON.stringify(
          {
            contractVersion: "1.1",
            status: "failed",
            timestamp: new Date().toISOString(),
            durationMs: 0,
            collection: {
              mode: "fixture",
              pagesFetched: 0,
              recordsReceived: 0,
              isComplete: false,
              duplicatesSkipped: 0,
            },
            part1: { status: "not_run", count: 0 },
            part2: {
              canonical: {
                schemaValid: false,
                rulesEvaluated: 0,
                passed: false,
                violations: [],
              },
              simulation: {
                expectedCode: "HIGH_PRIORITY_PR_IS_DRAFT",
                detected: false,
                passed: false,
              },
            },
            error: {
              code:
                error instanceof ConfigurationError
                  ? "CONFIGURATION_ERROR"
                  : "UNEXPECTED_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          },
          null,
          2,
        ),
      );
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
