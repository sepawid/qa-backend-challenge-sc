import { parseArgs } from "node:util";
import { GitHubPullRequestClient } from "../core/github-client.js";
import { countOpenNonDraftPullRequests } from "../business/pull-request-monitor.js";
import { aggregateResponseSchema } from "../schemas/aggregate.schema.js";
import { validateAggregateRules } from "../business/aggregate-rules.js";
import {
  QaChallengeError,
  ConfigurationError,
  TransportError,
  HttpError,
  SchemaValidationError,
  PaginationError,
} from "../core/errors.js";
import { createFixtureFetch } from "../demo/fixture-fetch.js";
import { sampleAggregateResponse } from "../demo/fixtures/aggregate-response.js";
import { aggregateHighPriorityDraftFixture } from "../demo/fixtures/aggregate-high-priority-draft.js";
import {
  buildRunResult,
  type RunResult,
  type RunErrorDetails,
} from "./presentation-model.js";
import { TerminalFormatter } from "./formatter.js";
import {
  cliOptionsSchema,
  parseEnvironmentConfig,
} from "../schemas/config.schema.js";

export interface CliArguments {
  mode: "fixture" | "live";
  format: "human" | "json";
}

export interface ShowcaseDeps {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly canonicalAggregate?: unknown;
  readonly simulationAggregate?: unknown;
  readonly stdout?: ((s: string) => void) | undefined;
  readonly stderr?: ((s: string) => void) | undefined;
  readonly now?: (() => number) | undefined;
}

export function parseCliArgs(rawArgs: string[] = process.argv.slice(2)): CliArguments {
  let parsedValues: Record<string, string | boolean | (string | boolean)[] | undefined>;
  try {
    const { values } = parseArgs({
      args: rawArgs,
      options: {
        mode: { type: "string", default: "fixture" },
        format: { type: "string", default: "human" },
      },
      strict: true,
    });
    parsedValues = values;
  } catch (error) {
    throw new ConfigurationError(
      `Invalid CLI arguments: ${error instanceof Error ? error.message : String(error)}. Allowed options: --mode=<fixture|live>, --format=<human|json>`,
    );
  }

  const result = cliOptionsSchema.safeParse({
    mode: parsedValues["mode"],
    format: parsedValues["format"],
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join("; ");
    throw new ConfigurationError(
      `Invalid CLI options: ${issues}. Allowed values: --mode=<fixture|live>, --format=<human|json>`,
    );
  }

  return result.data;
}

export function mapErrorToExitCode(error: unknown): number {
  if (error instanceof ConfigurationError) return 2;
  if (error instanceof TransportError) return 3;
  if (error instanceof HttpError) return 3;
  if (error instanceof SchemaValidationError) return 4;
  if (error instanceof PaginationError) return 5;
  if (error instanceof QaChallengeError) return 1;
  return 1;
}

export async function runShowcase(
  args: CliArguments,
  deps: ShowcaseDeps = {},
): Promise<{ exitCode: number; result: RunResult }> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s));
  const now = deps.now ?? Date.now;
  const canonicalAggregate = deps.canonicalAggregate ?? sampleAggregateResponse;
  const simulationAggregate = deps.simulationAggregate ?? aggregateHighPriorityDraftFixture;

  const formatter = new TerminalFormatter();
  const startTime = now();
  const observedFrom = new Date(startTime).toISOString();

  const isJson = args.format === "json";
  const log = isJson
    ? (...items: unknown[]) => stderr(`${items.join(" ")}\n`)
    : (...items: unknown[]) => stdout(`${items.join(" ")}\n`);

  let pagesFetched = 0;
  let recordsReceived = 0;

  try {
    const envConfig = parseEnvironmentConfig(env);

    if (!isJson) {
      log(formatter.banner(
        "QA BACKEND TECHNICAL CHALLENGE — SHOWCASE RUNNER",
        `Execution Mode: [${args.mode.toUpperCase()}] | Language: TypeScript (Node.js 24+, Vitest, Zod)`,
      ));

      log(formatter.section("1. ARCHITECTURE BOUNDARIES"));
      log("  Transport: native fetch + RFC 8288 rel=\"next\" parser + SSRF/loop protections");
      log("  Validation: per-page Zod wire schema validation");
      log("  Domain Logic: pure, zero-I/O open non-draft filtering & aggregate rules");
      log("  CI Observability: structured exit codes, latency metrics & actionable diagnostics");
    }

    // PART 1: GITHUB API INTEGRATION
    if (!isJson) {
      log(formatter.section("2. PART 1: GITHUB API DATA INTEGRATION"));
      log(`  Target: https://api.github.com/repos/appwrite/appwrite/pulls`);
      log(`  Source: ${args.mode === "live" ? "Live GitHub API" : "Multi-page deterministic fixture (3 pages)"}`);
      log(`  Pagination progress:`);
    }

    const client = new GitHubPullRequestClient({
      fetchImpl: deps.fetchImpl ?? (args.mode === "live" ? fetch : createFixtureFetch()),
      token: envConfig.GITHUB_TOKEN,
      timeoutMs: envConfig.GITHUB_TIMEOUT_MS,
      maxPages: envConfig.GITHUB_MAX_PAGES,
      onPageFetched: (event) => {
        pagesFetched = event.pageNumber;
        recordsReceived = event.accumulatedCount;
        if (!isJson) {
          log(
            `    • Page ${event.pageNumber}: fetched ${event.itemCount} PRs ` +
            `(accumulated: ${event.accumulatedCount}, latency: ${event.durationMs}ms, ` +
            `rate-limit remaining: ${event.rateLimitRemaining ?? "n/a"}) [✓ Valid Zod Schema]`,
          );
        }
      },
    });

    const part1Result = await client.fetchAllOpenPullRequests();
    pagesFetched = part1Result.pagesFetched;
    recordsReceived = part1Result.recordsReceived;

    const finalOpenNonDraftCount = countOpenNonDraftPullRequests(part1Result.pullRequests);
    const draftCount = part1Result.pullRequests.filter((pr) => pr.draft).length;

    if (!isJson) {
      log(formatter.section("PART 1 RESULTS"));
      log(formatter.metric("Pages Fetched", part1Result.pagesFetched));
      log(formatter.metric("Total Records Retrieved", part1Result.recordsReceived));
      log(formatter.metric("Draft Records Excluded", draftCount));
      log(formatter.metric("FINAL OPEN NON-DRAFT COUNT", finalOpenNonDraftCount, "Official Challenge Metric"));
      log(formatter.metric("Pagination Completed", part1Result.isComplete ? "YES (All pages followed)" : "NO"));
      if (part1Result.rateLimit?.remaining !== undefined) {
        log(formatter.metric("GitHub Rate-Limit Remaining", part1Result.rateLimit.remaining));
      }
    }

    // PART 2: MIDDLEWARE AGGREGATE VALIDATION
    if (!isJson) {
      log(formatter.section("3. PART 2: MIDDLEWARE AGGREGATE BUSINESS RULES"));
    }

    // Scenario 2A: Canonical payload happy path
    const canonicalParseResult = aggregateResponseSchema.safeParse(canonicalAggregate);
    if (!canonicalParseResult.success) {
      const issues = canonicalParseResult.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      );
      throw new SchemaValidationError(
        `Part 2 canonical aggregate schema validation failed: ${issues.join("; ")}`,
        { zodIssues: issues },
      );
    }
    const canonicalValidated = canonicalParseResult.data;
    const canonicalRules = validateAggregateRules(canonicalValidated);

    const hasCountMismatch = canonicalRules.violations.some((v) => v.code === "PR_COUNT_MISMATCH");
    const hasHighPriorityDraft = canonicalRules.violations.some((v) => v.code === "HIGH_PRIORITY_PR_IS_DRAFT");
    const rule1Badge = hasCountMismatch ? formatter.badge("FAIL", "fail") : formatter.badge("PASS", "pass");
    const rule2Badge = hasHighPriorityDraft ? formatter.badge("FAIL", "fail") : formatter.badge("PASS", "pass");

    if (!isJson) {
      log(`  Scenario A: Canonical challenge payload (product_id="${canonicalValidated.product_id}")`);
      log(`    • Rule 1 (Integrity: total_open_prs == prs.length): ${rule1Badge}`);
      log(`    • Rule 2 (high-priority PRs must not be draft):     ${rule2Badge}`);
      if (canonicalRules.violations.length > 0) {
        for (const v of canonicalRules.violations) {
          log(`      ${formatter.red(`[Violation] ${v.message}`)}`);
        }
      }
    }

    // Scenario 2B: Controlled violation simulation for CI observability
    const violationParseResult = aggregateResponseSchema.safeParse(simulationAggregate);
    if (!violationParseResult.success) {
      const issues = violationParseResult.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      );
      throw new SchemaValidationError(
        `Part 2 simulation aggregate schema validation failed: ${issues.join("; ")}`,
        { zodIssues: issues },
      );
    }
    const violationValidated = violationParseResult.data;
    const violationRules = validateAggregateRules(violationValidated);

    const expectedCode = "HIGH_PRIORITY_PR_IS_DRAFT";
    const simulationDetected = violationRules.violations.some((v) => v.code === expectedCode);

    const targetPr = violationValidated.pull_requests.find(
      (pr) => pr.labels.includes("high-priority") && pr.meta.is_draft,
    );
    const prDesc = targetPr
      ? `PR #${targetPr.id} having label "high-priority" AND meta.is_draft=true`
      : `simulated violation payload`;

    if (!isJson) {
      log(`\n  Scenario B: Controlled Defensive Demonstration (Simulated Violation)`);
      log(`    • Payload with ${prDesc}`);
      if (simulationDetected) {
        const violationMessage = violationRules.violations.map((v) => `      [Expected Failure Caught] ${v.message}`).join("\n");
        log(formatter.yellow(violationMessage));
        log(`    • Observability Status: ${formatter.badge("RULE ENFORCED", "sim")} (Clear actionable diagnostic message)`);
      } else {
        log(`    • Observability Status: ${formatter.badge("VIOLATION NOT DETECTED", "fail")} (Expected ${expectedCode} was not caught)`);
      }
    }

    const isPassed = part1Result.isComplete && canonicalRules.isValid && simulationDetected;
    const finalStatus = isPassed ? "passed" : "failed";
    const finalExitCode = isPassed ? 0 : 1;

    const durationMs = now() - startTime;
    const observedTo = new Date(now()).toISOString();

    const runResult = buildRunResult({
      mode: args.mode,
      status: finalStatus,
      observedFrom,
      observedTo,
      fixtureName: args.mode === "fixture" ? "multi-page-deterministic-fixture" : undefined,
      pagesFetched: part1Result.pagesFetched,
      recordsReceived: part1Result.recordsReceived,
      draftRecords: draftCount,
      openNonDraftRecords: finalOpenNonDraftCount,
      paginationComplete: part1Result.isComplete,
      schemaValid: true,
      aggregateValid: canonicalRules.isValid,
      violations: canonicalRules.violations,
      simulation: {
        expectedViolation: expectedCode,
        detected: simulationDetected,
      },
      durationMs,
    });

    if (isJson) {
      stdout(`${JSON.stringify(runResult, null, 2)}\n`);
    } else {
      log(formatter.section("4. CONCLUSION & VERIFICATION EVIDENCE"));
      const conclusionBadge = isPassed
        ? formatter.badge("ALL REQUIREMENTS SATISFIED", "pass")
        : formatter.badge("REQUIREMENTS FAILED", "fail");
      log(`  Showcase completed in ${durationMs}ms with status: ${conclusionBadge}`);
      log(`\n  To run independent test suites:`);
      log(`    • Deterministic offline tests: ${formatter.cyan("npm test")}`);
      log(`    • Live GitHub API test:        ${formatter.cyan("npm run test:live")}`);
      log(`    • Automated CI check:          ${formatter.cyan("npm run check")}\n`);
    }

    return { exitCode: finalExitCode, result: runResult };
  } catch (error) {
    const durationMs = now() - startTime;
    const observedTo = new Date(now()).toISOString();
    const exitCode = mapErrorToExitCode(error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    let errorCode = "UNKNOWN_ERROR";
    let errorPage: number | undefined;

    if (error instanceof QaChallengeError) {
      errorCode = error.code;
      errorPage = error.context.page;
    } else if (error instanceof Error) {
      errorCode = error.name;
    }

    const isSchemaError = error instanceof SchemaValidationError;

    const errorDetails: RunErrorDetails = {
      code: errorCode,
      message: errorMessage,
      ...(errorPage !== undefined ? { page: errorPage } : {}),
    };

    if (!isJson) {
      log(formatter.section("ERROR"));
      log(`  ${formatter.yellow(errorMessage)}`);
    }

    const incompleteResult = buildRunResult({
      mode: args.mode,
      status: "incomplete",
      error: errorDetails,
      observedFrom,
      observedTo,
      fixtureName: args.mode === "fixture" ? "multi-page-deterministic-fixture" : undefined,
      pagesFetched,
      recordsReceived,
      draftRecords: 0,
      openNonDraftRecords: 0,
      paginationComplete: false,
      schemaValid: isSchemaError ? false : null,
      aggregateValid: false,
      violations: [],
      durationMs,
    });

    if (isJson) {
      stdout(`${JSON.stringify(incompleteResult, null, 2)}\n`);
    }

    return { exitCode, result: incompleteResult };
  }
}

// Entrypoint execution when invoked directly
if (process.argv[1] && process.argv[1].endsWith("cli.ts")) {
  try {
    const args = parseCliArgs();
    runShowcase(args)
      .then(({ exitCode }) => {
        process.exit(exitCode);
      })
      .catch((error) => {
        console.error("\nShowcase execution encountered an error:", error instanceof Error ? error.message : String(error));
        process.exit(mapErrorToExitCode(error));
      });
  } catch (error) {
    console.error("\nShowcase execution encountered an error:", error instanceof Error ? error.message : String(error));
    process.exit(mapErrorToExitCode(error));
  }
}
