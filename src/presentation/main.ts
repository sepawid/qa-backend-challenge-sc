import {
  parseCliArgs,
  runShowcase,
  mapErrorToExitCode,
  detectRequestedOutput,
  describeError,
  buildErrorResult,
} from "./cli.js";

async function main(): Promise<void> {
  let format: "human" | "json" = "human";
  try {
    const args = parseCliArgs(process.argv.slice(2));
    format = args.format;
    const { exitCode } = await runShowcase(args);
    process.exit(exitCode);
  } catch (error) {
    const exitCode = mapErrorToExitCode(error);
    const requested = detectRequestedOutput(process.argv.slice(2));
    const wantsJson = format === "json" || requested.format === "json";

    if (wantsJson) {
      const nowIso = new Date().toISOString();
      const errorDetails = describeError(error);
      const fallbackResult = buildErrorResult({
        mode: requested.mode,
        error: errorDetails,
        observedFrom: nowIso,
        observedTo: nowIso,
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
