import { describe, expect, it } from "vitest";
import { buildRunResult, KNOWN_LIMITATIONS } from "../../src/presentation/presentation-model.js";

describe("Presentation: presentation-model", () => {
  it("constructs a valid RunResult adhering to contractVersion 1.2", () => {
    const result = buildRunResult({
      mode: "fixture",
      status: "passed",
      observedFrom: "2024-01-01T00:00:00Z",
      observedTo: "2024-01-01T00:00:01Z",
      fixtureName: "test-fixture",
      pagesFetched: 3,
      recordsReceived: 6,
      uniqueRecords: 6,
      draftRecords: 2,
      openNonDraftRecords: 4,
      paginationComplete: true,
      schemaValid: true,
      aggregateValid: true,
      simulation: {
        expectedViolation: "HIGH_PRIORITY_PR_IS_DRAFT",
        detected: true,
      },
      durationMs: 100,
    });

    expect(result.contractVersion).toBe("1.2");
    expect(result.mode).toBe("fixture");
    expect(result.status).toBe("passed");
    expect(result.source.provider).toBe("github");
    expect(result.source.repository).toBe("appwrite/appwrite");
    expect(result.source.fixtureName).toBe("test-fixture");
    expect(result.collection.pagesFetched).toBe(3);
    expect(result.collection.recordsReceived).toBe(6);
    expect(result.collection.uniqueRecords).toBe(6);
    expect(result.collection.draftRecords).toBe(2);
    expect(result.collection.openNonDraftRecords).toBe(4);
    expect(result.collection.paginationComplete).toBe(true);
    expect(result.validation.schemaValid).toBe(true);
    expect(result.validation.aggregateValid).toBe(true);
    expect(result.validation.violations).toEqual([]);
    expect(result.limitations).toEqual(KNOWN_LIMITATIONS);
  });

  it("supports tri-state aggregateValid and schemaValid (null) on incomplete runs", () => {
    const result = buildRunResult({
      mode: "live",
      status: "incomplete",
      observedFrom: "2024-01-01T00:00:00Z",
      observedTo: "2024-01-01T00:00:01Z",
      pagesFetched: 0,
      recordsReceived: 0,
      uniqueRecords: 0,
      draftRecords: 0,
      openNonDraftRecords: 0,
      paginationComplete: false,
      schemaValid: null,
      aggregateValid: null,
      error: {
        code: "TRANSPORT_ERROR",
        message: "Network failure",
      },
      durationMs: 50,
    });

    expect(result.status).toBe("incomplete");
    expect(result.validation.schemaValid).toBeNull();
    expect(result.validation.aggregateValid).toBeNull();
    expect(result.error?.code).toBe("TRANSPORT_ERROR");
  });
});

