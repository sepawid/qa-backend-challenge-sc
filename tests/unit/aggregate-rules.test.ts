import { describe, expect, it } from "vitest";
import {
  assertAggregateRules,
  validateAggregateRules,
  AggregateRuleError,
} from "../../src/business/aggregate-rules.js";
import { aggregateResponseSchema } from "../../src/schemas/aggregate.schema.js";
import { sampleAggregateResponse } from "../fixtures/aggregate-response.js";
import { aggregateCountMismatchFixture } from "../fixtures/aggregate-count-mismatch.js";
import { aggregateHighPriorityDraftFixture } from "../fixtures/aggregate-high-priority-draft.js";

describe("Business Logic: aggregate-rules (Part 2)", () => {
  it("passes for the canonical challenge sample payload", () => {
    // Validate schema shape first
    const validated = aggregateResponseSchema.parse(sampleAggregateResponse);
    // Validate business rules
    const result = validateAggregateRules(validated);
    expect(result.isValid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(() => assertAggregateRules(validated)).not.toThrow();
  });

  it("fails with PR_COUNT_MISMATCH when pull_requests.length !== total_open_prs", () => {
    const validated = aggregateResponseSchema.parse(aggregateCountMismatchFixture);
    const result = validateAggregateRules(validated);

    expect(result.isValid).toBe(false);
    expect(result.violations).toHaveLength(1);
    const violation = result.violations[0];
    expect(violation?.code).toBe("PR_COUNT_MISMATCH");
    if (violation?.code === "PR_COUNT_MISMATCH") {
      expect(violation.expected).toBe(3);
      expect(violation.actual).toBe(1);
      expect(violation.message).toContain("total_open_prs=3");
    }

    expect(() => assertAggregateRules(validated)).toThrow(AggregateRuleError);
  });

  it("fails with HIGH_PRIORITY_PR_IS_DRAFT when a high-priority PR is a draft", () => {
    const validated = aggregateResponseSchema.parse(aggregateHighPriorityDraftFixture);
    const result = validateAggregateRules(validated);

    expect(result.isValid).toBe(false);
    expect(result.violations).toHaveLength(1);
    const violation = result.violations[0];
    expect(violation?.code).toBe("HIGH_PRIORITY_PR_IS_DRAFT");
    if (violation?.code === "HIGH_PRIORITY_PR_IS_DRAFT") {
      expect(violation.pullRequestId).toBe(1024);
      expect(violation.title).toBe("feat: add SQS support to testing commons");
      expect(violation.message).toContain("id=1024");
      expect(violation.message).toContain("must not be marked as draft");
    }

    expect(() => assertAggregateRules(validated)).toThrow(AggregateRuleError);
  });

  it("allows drafts if they do NOT have the high-priority label", () => {
    const payload = {
      product_id: "appwrite-001",
      total_open_prs: 1,
      last_updated: "2024-03-20T15:30:00Z",
      pull_requests: [
        {
          id: 2048,
          title: "chore: update dependencies",
          author: { username: "dev", role: "developer" },
          status: "OPEN",
          labels: ["refactor", "low-priority"],
          meta: { is_draft: true, review_comments: 0 }, // draft is allowed because NOT high-priority
        },
      ],
    };

    const validated = aggregateResponseSchema.parse(payload);
    const result = validateAggregateRules(validated);
    expect(result.isValid).toBe(true);
  });

  it("collects multiple violations when both rules are violated", () => {
    const payload = {
      product_id: "appwrite-001",
      total_open_prs: 5, // Violation 1: length is 1, expected 5
      last_updated: "2024-03-20T15:30:00Z",
      pull_requests: [
        {
          id: 1024,
          title: "feat: high priority draft",
          author: { username: "admin", role: "admin" },
          status: "OPEN",
          labels: ["high-priority"],
          meta: { is_draft: true, review_comments: 2 }, // Violation 2: high priority draft
        },
      ],
    };

    const validated = aggregateResponseSchema.parse(payload);
    const result = validateAggregateRules(validated);
    expect(result.isValid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map((v) => v.code)).toEqual([
      "PR_COUNT_MISMATCH",
      "HIGH_PRIORITY_PR_IS_DRAFT",
    ]);
  });

  it("rejects invalid wire-schema with ZodError before business rules run", () => {
    const malformedPayload = {
      product_id: "appwrite-001",
      // missing total_open_prs
      last_updated: "invalid-date",
      pull_requests: "not-an-array",
    };

    expect(() => aggregateResponseSchema.parse(malformedPayload)).toThrow();
  });

  it("passes for a high-priority PR that is NOT a draft", () => {
    const payload = {
      product_id: "appwrite-001",
      total_open_prs: 1,
      last_updated: "2024-03-20T15:30:00Z",
      pull_requests: [
        {
          id: 3072,
          title: "feat: critical security patch",
          author: { username: "lead", role: "admin" },
          status: "OPEN",
          labels: ["high-priority", "security"],
          meta: { is_draft: false, review_comments: 5 },
        },
      ],
    };

    const validated = aggregateResponseSchema.parse(payload);
    const result = validateAggregateRules(validated);
    expect(result.isValid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("passes when pull_requests.length equals total_open_prs exactly", () => {
    const payload = {
      product_id: "appwrite-001",
      total_open_prs: 2,
      last_updated: "2024-03-20T15:30:00Z",
      pull_requests: [
        {
          id: 4001,
          title: "feat: feature A",
          author: { username: "dev1", role: "developer" },
          status: "OPEN",
          labels: [],
          meta: { is_draft: false, review_comments: 0 },
        },
        {
          id: 4002,
          title: "fix: bug B",
          author: { username: "dev2", role: "developer" },
          status: "OPEN",
          labels: ["bug"],
          meta: { is_draft: true, review_comments: 1 },
        },
      ],
    };

    const validated = aggregateResponseSchema.parse(payload);
    const result = validateAggregateRules(validated);
    expect(result.isValid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
