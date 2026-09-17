import type { AggregateResponse } from "../schemas/aggregate.schema.js";

export type AggregateViolation =
  | {
      readonly code: "PR_COUNT_MISMATCH";
      readonly expected: number;
      readonly actual: number;
      readonly message: string;
    }
  | {
      readonly code: "HIGH_PRIORITY_PR_IS_DRAFT";
      readonly pullRequestId: number;
      readonly title: string;
      readonly message: string;
    };

export interface AggregateValidationResult {
  readonly isValid: boolean;
  readonly violations: readonly AggregateViolation[];
}

/**
 * Validates Part 2 business rules against an aggregate response payload:
 * 1. Integrity: pull_requests.length === total_open_prs
 * 2. Business rule: If a PR has label "high-priority" (exact match), it must NOT have meta.is_draft === true.
 *
 * Returns all detected violations without early exit.
 */
export function validateAggregateRules(response: AggregateResponse): AggregateValidationResult {
  const violations: AggregateViolation[] = [];

  // Rule 1: Integrity check between array length and total_open_prs field
  if (response.pull_requests.length !== response.total_open_prs) {
    violations.push({
      code: "PR_COUNT_MISMATCH",
      expected: response.total_open_prs,
      actual: response.pull_requests.length,
      message: `Integrity violation: expected total_open_prs=${response.total_open_prs}, but pull_requests array contains ${response.pull_requests.length} item(s)`,
    });
  }

  // Rule 2: High-priority PRs must not be drafts
  for (const pr of response.pull_requests) {
    if (pr.labels.includes("high-priority") && pr.meta.is_draft) {
      violations.push({
        code: "HIGH_PRIORITY_PR_IS_DRAFT",
        pullRequestId: pr.id,
        title: pr.title,
        message: `Business rule violation: high-priority pull request id=${pr.id} ("${pr.title}") must not be marked as draft`,
      });
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}

export class AggregateRuleError extends Error {
  constructor(
    message: string,
    public readonly violations: readonly AggregateViolation[],
  ) {
    super(message);
    this.name = "AggregateRuleError";
  }
}

/**
 * Asserts that the aggregate response satisfies all business rules.
 * Throws AggregateRuleError if any violation is detected.
 */
export function assertAggregateRules(response: AggregateResponse): void {
  const result = validateAggregateRules(response);
  if (!result.isValid) {
    const errorMessages = result.violations.map((v) => v.message).join("\n");
    throw new AggregateRuleError(`Aggregate validation failed:\n${errorMessages}`, result.violations);
  }
}
