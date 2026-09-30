# QA Engineer Backend Technical Challenge — Showcase Runner

A presentation-grade, production-minded QA test harness implemented in **TypeScript** (Node.js 24+, native `fetch`, Vitest, Zod).

The project solves the two core backend challenge tasks:
1. **Part 1 (Live Data Integration)**: Exhaustively navigates all open pull requests from [`appwrite/appwrite`](https://api.github.com/repos/appwrite/appwrite/pulls) across all pages using RFC 8288 `rel="next"` links, validates each page against Zod schemas, and calculates the final business metric (strictly `state === "open" && draft === false`).
2. **Part 2 (Business Rule Validation)**: Validates a middleware aggregate response payload for integrity (`pull_requests.length === total_open_prs`) and business rule compliance (PRs with label `"high-priority"` must never be drafts), outputting clear actionable error diagnostics.

---

## Quick Start

```bash
# 1. Install dependencies reproducibly
npm ci

# 2. Run full verification (typecheck + unit & integration tests + build)
npm run check

# 3. Launch the presentation showcase (runs deterministic 3-page fixture by default)
npm start

# 4. Or run from compiled distribution build
npm run start:dist
```

### Optional Live Verification (requires network)

```bash
# Optional: Set GITHUB_TOKEN to raise rate limits from 60 to 5,000 req/hr
export GITHUB_TOKEN="ghp_your_token_here"

# Run live GitHub API showcase in terminal
npm run demo:live

# Run live integration test suite with independent Search API oracle
npm run test:live
```

---

## Architectural Boundaries & Data Flow

```text
               [ GitHub REST API / Multi-Page Fixture ]
                                  │
                                  ▼
      ┌────────────────────────────────────────────────────────┐
      │  src/core/github-client.ts (Transport & Pagination)    │
      │  • RFC 8288 Link header parser (rel="next" resolution) │
      │  • sort=created&direction=asc pagination ordering     │
      │  • Cross-page deduplication & intra-page integrity     │
      │  • Repository pinning (/repositories/<id>/pulls)       │
      │  • SSRF origin verification & manual redirect reject  │
      │  • Cycle detection & rate-limit diagnostics            │
      │  • Request timeout & page count safety caps            │
      └───────────────────────────┬────────────────────────────┘
                                  │ Raw JSON payload per page
                                  ▼
      ┌────────────────────────────────────────────────────────┐
      │  src/schemas/ (Zod Wire-Schema Validation)             │
      │  • githubPullRequestPageSchema (.passthrough())        │
      │  • aggregateResponseSchema (structural validation)     │
      └───────────────────────────┬────────────────────────────┘
                                  │ Validated Domain Models
                                  ▼
      ┌────────────────────────────────────────────────────────┐
      │  src/business/ (Pure, Zero-I/O Domain Logic)           │
      │  • countOpenNonDraftPullRequests (Part 1 metric)       │
      │  • validateAggregateRules (Part 2 integrity & rules)   │
      └───────────────────────────┬────────────────────────────┘
                                  │ Structured Results & Violations
                                  ▼
         ┌────────────────────────┴────────────────────────┐
         │                                                 │
         ▼                                                 ▼
[ Automated Tests (Vitest) ]              [ CLI Showcase Runner (tsx/node) ]
• 100% offline unit/integration           • Formatted progress & latency
• Opt-in live verification + oracle       • Machine-readable JSON contract 1.2
```

### Dependency Rules:
- `src/core/` handles HTTP I/O, timeouts, RFC 8288 link resolution, and pagination. Does not contain test assertions or business logic.
- `src/schemas/` validates wire data shapes and types via Zod schemas. Does not execute I/O or domain business logic.
- `src/business/` consists of pure, deterministic functions without side effects.
- `src/presentation/` coordinates workflow execution, dependency injection, and formats output for human or JSON consumption. Entrypoint is separated into `src/presentation/main.ts`.

---

## Requirement-to-Test Traceability Matrix

| Challenge Requirement | Implementation | Automated Verification |
|---|---|---|
| **Fetch every open PR across all pages** | `GitHubPullRequestClient.fetchAllOpenPullRequests` | `tests/integration/github-pagination.test.ts` (multi-page sequence) |
| **Do not assume single page** | Exhaustive `rel="next"` pagination loop | `tests/integration/github-pagination.test.ts` |
| **Validate API response structure** | `githubPullRequestPageSchema` (Zod) on each page | `tests/unit/github-client.test.ts` (malformed schema tests) |
| **Count strictly open non-draft PRs** | `countOpenNonDraftPullRequests` in `pull-request-monitor.ts` | `tests/unit/pull-request-monitor.test.ts` (state/draft matrix, historical dump) |
| **Part 2: Total open PRs integrity** | `validateAggregateRules` checking `length === total_open_prs` | `tests/unit/aggregate-rules.test.ts` (`PR_COUNT_MISMATCH` test) |
| **Part 2: High-priority draft rule** | Exact check: `labels.includes("high-priority") && is_draft` | `tests/unit/aggregate-rules.test.ts` (`HIGH_PRIORITY_PR_IS_DRAFT` test) |
| **Clear CI error observability** | Structured typed violations (`AggregateViolation`) & error formatting | `tests/unit/aggregate-rules.test.ts`, demonstrated via `npm start` |
| **RFC 8288 Link parser compliance** | `resolveNextLink` enforcing first `rel`, quoted-pairs, malformed syntax detection, and anchor scoping | `tests/unit/link-header.test.ts` |
| **Pagination semantic invariants** | Strict validation of `state=open`, `per_page=100`, `sort=created`, `direction=asc` & duplicate params | `tests/integration/github-pagination.test.ts` |
| **Numeric repository ID binding** | Authoritative pinning to base repository (`pr.base.repo.id`) | `tests/integration/github-pagination.test.ts` |
| **Transport vs Schema Separation** | Body stream aborts throw `TransportError`; invalid JSON/wire throws `SchemaValidationError` | `tests/integration/transport-body-abort.test.ts` |
| **Preservation of Stage Results** | Canonical aggregate validation preserved even if simulation aggregate payload fails schema | `tests/unit/cli.test.ts` |
| **Search Oracle Rate-Limit & Metadata** | Distinguishes primary/secondary rate-limits from non-rate-limit 403; checks `incomplete_results` | `tests/live/github-pulls.live.test.ts` |
| **Rate-Limit Diagnostics Resilience** | Safe parsing of timestamps preventing `RangeError`/`NaN` crashes | `tests/unit/github-client.test.ts` |
| **Environment Isolation in E2E** | Subprocesses executed with sanitized env stripping hostile `GITHUB_*` and `LIVE_TOLERANCE` | `tests/integration/cli-e2e.test.ts` |
| **Deterministic test isolation** | Offline scripted fake transport & real local HTTP server | `npm test` runs 100% offline without external network dependencies |

---

## Pagination, Defense-in-Depth & Security

1. **Authoritative RFC 8288 Pagination (`rel="next"`)**:
   - The client parses the HTTP `Link` header using `resolveNextLink` (`src/core/link-header.ts`).
   - **RFC 8288 §3.3 Relation Parameter**: The first `rel` parameter takes precedence. Subsequent `rel` parameters in the same link are ignored.
   - **RFC 8288 App B.4 Quoted-Pairs**: Quoted-pairs (e.g. `rel="ne\xt"`) are decoded to `next`.
   - **RFC 8288 §3.1–§3.2 Anchor Context**: Links targeting a foreign `anchor` context (different from the current representation URL) are filtered out, avoiding false ambiguity.
   - **Syntax Validation**: Malformed link headers (unclosed `<...>` or quotes) return `{ kind: "malformed" }` and throw `PaginationError` (exit code 5), preventing silent truncation.
   - **Ambiguity Detection**: Multiple distinct valid `rel="next"` targets raise `PaginationError`. Duplicate identical URLs are safely normalized.
   - Relative URLs (e.g. `</repos/owner/repo/pulls?page=2>`) are resolved against `currentUrl` via `new URL(target, currentUrl)`.
2. **Pagination Query Parameter Semantic Invariants**:
   - Any `rel="next"` URL must strictly preserve `state=open`, `per_page=100`, `sort=created`, and `direction=asc`.
   - Links with missing invariants or contradictory duplicate keys (e.g. `?page=2&page=3`) are rejected with `PaginationError`.
3. **Repository Identity & Base Repository Pinning**:
   - The expected target repository is established from the initial endpoint (`/repos/:owner/:repo/pulls`).
   - The numeric repository ID is extracted and pinned from the base repository (`pr.base.repo.id` and `pr.base.repo.full_name`), not head/fork.
   - Numeric links (`/repositories/:id/pulls`) are rejected unless the identity is confirmed and matches the pinned ID.
4. **Transport Body Read vs Schema Validation Separation**:
   - Reading the HTTP response body (`response.text()`) is isolated. Network aborts, timeouts, or severed sockets throw `TransportError` (exit code 3), preserving the underlying cause.
   - Completed bodies with syntax errors or schema mismatches throw `SchemaValidationError` (exit code 4).
5. **Cross-Page Deduplication & Intra-Page Integrity**:
   - Duplicate IDs within the same page are treated as an upstream API defect and throw `PaginationError`.
   - Shifted records across page boundaries are safely deduplicated.
   - Metrics guarantee: `recordsReceived = uniqueRecords + duplicatesSkipped`.
6. **SSRF & Credential Protection**:
   - Pagination URLs require `https:` (loopback `127.0.0.1`/`localhost` permitted for local tests), trusted origin matching, and no embedded credentials or URL fragments.
   - Redirects are set to `redirect: manual`. Any `3xx` response is rejected immediately to protect credentials.
7. **Loop & Cycle Detection**:
   - Maintains a set of visited URLs. Encountering a previously visited pagination URL immediately raises `PaginationError`.
8. **Safety Limits, Timeouts & Diagnostic HTTP Errors**:
   - Enforces safety limit caps (`GITHUB_MAX_PAGES`, default: 20) and timeout controls (`GITHUB_TIMEOUT_MS`, default: 10,000ms).
   - Rate-limit headers are parsed safely to prevent `RangeError` / `NaN` exceptions from malformed reset timestamps.

---

## Part 1 vs Part 2 Independence & Assumptions

> [!NOTE]
> Part 1 and Part 2 represent **two independent exercises**:
> - Part 1 interacts with the public live GitHub REST API for `appwrite/appwrite`.
> - Part 2 validates a mock middleware aggregate response.
>
> The field `total_open_prs` in Part 2 is validated solely against the `pull_requests` array within that same payload. It is **never** compared against the live count from Part 1, as they represent separate observation boundaries.

### Consistency Limitations in Live Data:
- The GitHub REST API does not provide atomic multi-page repository snapshots.
- Using `sort=created&direction=asc` alongside cross-page deduplication protects against record inflation. However, if a PR is closed while pagination is in progress, offset shifting can theoretically skip a record (an inherent limitation of offset-based pagination).
- To verify the integrity of the live count, `tests/live/github-pulls.live.test.ts` queries the independent GitHub Search API (`repo:appwrite/appwrite is:pr is:open draft:false`) and validates that the delta between the paginated count and search oracle is within `LIVE_TOLERANCE` (default: 3; validated via `environmentConfigSchema` as an integer between 0 and 1000; invalid values fail loud with `ConfigurationError`).

### Part 2 Business Rule Assumptions:
- **Exact Label Matching**: The specification mandates checking for the `"high-priority"` label. Matching is exact (case-sensitive, untrimmed). A label with different casing (e.g. `"High-Priority"`) or padding whitespace (e.g. `" high-priority "`) does not trigger Rule 2. If business requirements demand case-insensitivity or whitespace trimming, it can be extended via normalization without architectural changes.
- **Array Length vs. `total_open_prs`**: Rule 1 verifies that `pull_requests.length === total_open_prs`. It validates wire payload integrity (i.e. whether the payload contains the declared number of records) regardless of individual PR `status`. Closed PRs inside the array still count toward the array length.

---

## CI/CD Exit Codes & Machine-Readable Output

When running with `--format=json`, the CLI emits clean, versioned JSON (Contract 1.2) directly to `stdout`.

> [!TIP]
> **Clean Machine-Readable Execution**:
> To guarantee clean stdout without npm lifecycle banners or diagnostic logs, use either:
> ```bash
> # Option A: Silent npm script
> npm run demo:json --silent
>
> # Option B: Direct compiled Node process (recommended for CI pipelines)
> node dist/presentation/main.js --format=json
> ```

```json
{
  "contractVersion": "1.2",
  "mode": "fixture",
  "status": "passed",
  "source": {
    "provider": "github",
    "repository": "appwrite/appwrite",
    "observedFrom": "2026-09-30T12:12:49.183Z",
    "observedTo": "2026-09-30T12:12:49.201Z",
    "fixtureName": "multi-page-deterministic-fixture"
  },
  "collection": {
    "pagesFetched": 3,
    "recordsReceived": 6,
    "uniqueRecords": 6,
    "duplicatesSkipped": 0,
    "draftRecords": 2,
    "openNonDraftRecords": 4,
    "paginationComplete": true
  },
  "validation": {
    "schemaValid": true,
    "aggregateValid": true,
    "violations": [],
    "simulation": {
      "expectedViolation": "HIGH_PRIORITY_PR_IS_DRAFT",
      "detected": true
    }
  },
  "durationMs": 18,
  "limitations": [
    "GitHub REST API does not provide atomic multi-page repository snapshots.",
    "Pull requests can be opened, closed, or shifted across pages during live collection.",
    "Rate limits for unauthenticated GitHub API requests are capped at 60 requests per hour.",
    "Part 1 live results and Part 2 middleware aggregate represent decoupled systems."
  ]
}
```

In failure scenarios, structured error details conforming to the same `RunResult` contract are emitted. Notice that:
- `aggregateValid` and `schemaValid` are tri-state (`boolean | null`). When execution fails before Part 2 aggregate business rules can be evaluated, `aggregateValid` remains `null`.
- If Part 2 canonical validation succeeds, but the controlled simulation aggregate fails schema validation, canonical `aggregateValid: true` is preserved, and `schemaValid` reflects `false`.
- Partial collection metrics (`pagesFetched`, `recordsReceived`, `uniqueRecords`, `duplicatesSkipped`) are preserved even if a later page encounters an error:

```json
{
  "contractVersion": "1.2",
  "mode": "live",
  "status": "incomplete",
  "error": {
    "code": "HTTP_ERROR",
    "message": "GitHub API responded with HTTP 403 Forbidden: API rate limit exceeded...",
    "page": 3
  },
  "source": {
    "provider": "github",
    "repository": "appwrite/appwrite",
    "observedFrom": "2026-09-30T07:00:00.000Z",
    "observedTo": "2026-09-30T07:00:00.012Z"
  },
  "collection": {
    "pagesFetched": 2,
    "recordsReceived": 200,
    "uniqueRecords": 200,
    "duplicatesSkipped": 0,
    "draftRecords": 12,
    "openNonDraftRecords": 188,
    "paginationComplete": false
  },
  "validation": {
    "schemaValid": null,
    "aggregateValid": null,
    "violations": []
  },
  "durationMs": 12,
  "limitations": [ ... ]
}
```

### Exit Codes:
| Code | Category | Condition |
|---:|---|---|
| `0` | Success | All tasks succeeded: Part 1 completed pagination, Part 2 canonical aggregate passed, and simulation caught expected violation. |
| `1` | Business Rule Violation / QA Failure | Canonical aggregate rule violation (`PR_COUNT_MISMATCH` or `HIGH_PRIORITY_PR_IS_DRAFT`), or failure to detect simulation violation. |
| `2` | Configuration Error | Invalid environment variable values (`GITHUB_TOKEN`, `GITHUB_TIMEOUT_MS`, `GITHUB_MAX_PAGES`, `LIVE_TOLERANCE`) or invalid CLI options. |
| `3` | Transport / HTTP Error | Network socket failure, body stream abort/timeout, HTTP 4xx/5xx responses, or unauthenticated rate limit exhaustion. |
| `4` | Schema Validation Error | Wire-schema validation failed (Zod parsing error on GitHub PR page or aggregate response) or malformed non-JSON body. |
| `5` | Pagination Anomaly | RFC 8288 ambiguous or malformed `rel="next"` links, query parameter invariant violations, loop detected, repo ID mismatch, or intra-page duplicate IDs. |
| `6` | Unexpected Error | Unhandled internal exception (e.g. `TypeError`, system failure) distinct from domain/challenge assertions. |

---

## Deliberate Non-Goals (Anti-Overengineering)

To keep the solution focused, maintainable, and aligned with Senior QA principles:
- **No Database / Cache**: Ephemeral verification without database migrations or storage state.
- **No Web Server / UI Framework**: CLI presentation runner provides clear, immediate terminal visualization.
- **No Broad Retry / Backoff Framework**: Retrying schema validation or 4xx errors masks real defects. Network retries should not blindly mask upstream issues or lack of idempotency.
- **No Author Ranking / Vanity Metrics**: Focus remains on contract integrity and business count accuracy.
