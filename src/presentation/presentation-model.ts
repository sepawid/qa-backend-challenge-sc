import type { AggregateViolation } from "../business/aggregate-rules.js";

export interface PresentationSource {
  readonly provider: "github";
  readonly repository: "appwrite/appwrite";
  readonly observedFrom: string;
  readonly observedTo: string;
  readonly fixtureName?: string | undefined;
}

export interface CollectionMetrics {
  readonly pagesFetched: number;
  readonly recordsReceived: number;
  readonly uniqueRecords: number;
  readonly duplicatesSkipped: number;
  readonly draftRecords: number;
  readonly openNonDraftRecords: number;
  readonly paginationComplete: boolean;
}

export interface SimulationResult {
  readonly expectedViolation: string;
  readonly detected: boolean;
}

export interface RunErrorDetails {
  readonly code: string;
  readonly message: string;
  readonly page?: number | undefined;
}

export interface ValidationSummary {
  readonly schemaValid: boolean | null;
  readonly aggregateValid: boolean | null;
  readonly violations: readonly AggregateViolation[];
  readonly simulation?: SimulationResult | undefined;
}

export interface RunResult {
  readonly contractVersion: "1.2";
  readonly mode: "fixture" | "live";
  readonly status: "passed" | "failed" | "incomplete";
  readonly error?: RunErrorDetails | undefined;
  readonly source: PresentationSource;
  readonly collection: CollectionMetrics;
  readonly validation: ValidationSummary;
  readonly durationMs: number;
  readonly limitations: readonly string[];
}

export const KNOWN_LIMITATIONS: readonly string[] = [
  "GitHub REST API does not provide atomic multi-page repository snapshots.",
  "Pull requests can be opened, closed, or shifted across pages during live collection.",
  "Rate limits for unauthenticated GitHub API requests are capped at 60 requests per hour.",
  "Part 1 live results and Part 2 middleware aggregate represent decoupled systems.",
];

export function buildRunResult(params: {
  mode: "fixture" | "live";
  status: "passed" | "failed" | "incomplete";
  observedFrom: string;
  observedTo: string;
  fixtureName?: string | undefined;
  pagesFetched: number;
  recordsReceived: number;
  uniqueRecords: number;
  duplicatesSkipped?: number | undefined;
  draftRecords: number;
  openNonDraftRecords: number;
  paginationComplete: boolean;
  schemaValid: boolean | null;
  aggregateValid: boolean | null;
  violations?: readonly AggregateViolation[] | undefined;
  simulation?: SimulationResult | undefined;
  error?: RunErrorDetails | undefined;
  durationMs: number;
  limitations?: readonly string[] | undefined;
}): RunResult {
  return {
    contractVersion: "1.2",
    mode: params.mode,
    status: params.status,
    ...(params.error !== undefined ? { error: params.error } : {}),
    source: {
      provider: "github",
      repository: "appwrite/appwrite",
      observedFrom: params.observedFrom,
      observedTo: params.observedTo,
      ...(params.fixtureName !== undefined ? { fixtureName: params.fixtureName } : {}),
    },
    collection: {
      pagesFetched: params.pagesFetched,
      recordsReceived: params.recordsReceived,
      uniqueRecords: params.uniqueRecords,
      duplicatesSkipped: params.duplicatesSkipped ?? 0,
      draftRecords: params.draftRecords,
      openNonDraftRecords: params.openNonDraftRecords,
      paginationComplete: params.paginationComplete,
    },
    validation: {
      schemaValid: params.schemaValid,
      aggregateValid: params.aggregateValid,
      violations: params.violations ?? [],
      ...(params.simulation !== undefined ? { simulation: params.simulation } : {}),
    },
    durationMs: params.durationMs,
    limitations: params.limitations ?? KNOWN_LIMITATIONS,
  };
}
