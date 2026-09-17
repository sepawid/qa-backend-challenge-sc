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

# 2. Run full verification (typecheck + 57 unit & integration tests + build)
npm run check

# 3. Launch the presentation showcase (runs deterministic 3-page fixture by default)
npm start
```

### Optional Live Verification (requires network)

```bash
# Optional: Set GITHUB_TOKEN to raise rate limits from 60 to 5,000 req/hr
export GITHUB_TOKEN="ghp_your_token_here"

# Run live GitHub API showcase in terminal
npm run demo:live

# Run live integration test suite
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
      │  • RFC 8288 Link header parsing (rel="next")          │
      │  • SSRF origin verification & manual redirect reject  │
      │  • Cycle detection & duplicate PR ID protection        │
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
[ Automated Tests (Vitest) ]              [ CLI Showcase Runner (tsx) ]
• 100% offline unit/integration           • Formatted progress & latency
• Opt-in live verification                • Machine-readable JSON output
```

### Dependency Rules:
- `src/core/` handles HTTP I/O, timeouts, and pagination. Does not contain Vitest assertions or business logic.
- `src/schemas/` validates data shape and types. Does not execute I/O or domain business logic.
- `src/business/` consists of pure, deterministic functions without side effects.
- `src/presentation/` coordinates workflow execution and formats output for human or JSON consumption.

---

## Requirement-to-Test Traceability Matrix

| Challenge Requirement | Implementation | Automated Verification |
|---|---|---|
| **Fetch every open PR across all pages** | `GitHubPullRequestClient.fetchAllOpenPullRequests` | `tests/integration/github-pagination.test.ts` (3-page sequence test) |
| **Do not assume single page** | Exhaustive `rel="next"` pagination loop | Verified via mock transport tracking all request URLs |
| **Validate API response structure** | `githubPullRequestPageSchema` (Zod) on each page | `tests/unit/github-client.test.ts` (malformed schema test) |
| **Count strictly open non-draft PRs** | `countOpenNonDraftPullRequests` in `pull-request-monitor.ts` | `tests/unit/pull-request-monitor.test.ts` (state/draft matrix test) |
| **Part 2: Total open PRs integrity** | `validateAggregateRules` checking `length === total_open_prs` | `tests/unit/aggregate-rules.test.ts` (`PR_COUNT_MISMATCH` test) |
| **Part 2: High-priority draft rule** | Exact check: `labels.includes("high-priority") && is_draft` | `tests/unit/aggregate-rules.test.ts` (`HIGH_PRIORITY_PR_IS_DRAFT` test) |
| **Clear CI error observability** | Structured typed violations (`AggregateViolation`) & error formatting | Tested in unit suite and demonstrated via `npm start` |
| **Deterministic test isolation** | Offline scripted fake transport | `npm test` runs 100% offline without network dependencies |
| **Live verification** | Dedicated live suite calling `api.github.com/repos/appwrite/appwrite/pulls` | `tests/live/github-pulls.live.test.ts` |

---

## Pagination, Defense-in-Depth & Security

1. **Authoritative Pagination (`rel="next"`)**:
   - The client parses the HTTP `Link` header using a focused RFC 8288-compatible parser (`src/core/link-header.ts`).
   - Pagination ceases when the `next` relation is absent. It does **not** rely on page counts or guessing page query parameters.
2. **SSRF & Credential Protection**:
   - Before requesting any next page, the client validates that the target URL protocol is `https:`, the origin matches `https://api.github.com`, and no embedded credentials exist.
   - Redirects are set to `redirect: manual`. Any `3xx` response is rejected immediately to prevent credential leaks to external hosts.
3. **Loop & Cycle Detection**:
   - Maintains a set of visited URLs. Encountering a previously visited pagination URL immediately raises `PaginationError`.
4. **Duplicate PR ID Protection**:
   - Tracks unique PR IDs across pages. If an upstream API malfunction causes duplicate records, it fails fast rather than silently inflating the business count.
5. **Safety Limits & Timeouts**:
   - Enforces a safety limit cap (`GITHUB_MAX_PAGES`, default: 20).
   - Requests use `AbortSignal.timeout(timeoutMs)` (`GITHUB_TIMEOUT_MS`, default: 10,000ms).

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
- A PR can be opened, closed, or moved between pages while pagination is in flight.
- The live total represents the best consistent read across consecutive pages at execution time.

---

## CI/CD Exit Codes & Machine-Readable Output

When running `--format=json`, the CLI emits clean, versioned JSON to `stdout` and diagnostic logs to `stderr`:

```bash
npm run demo:json
```

```json
{
  "contractVersion": "1.0",
  "mode": "fixture",
  "status": "passed",
  "source": {
    "provider": "github",
    "repository": "appwrite/appwrite",
    "observedFrom": "2026-09-15T09:24:21.491Z",
    "observedTo": "2026-09-15T09:24:21.507Z"
  },
  "collection": {
    "pagesFetched": 3,
    "recordsReceived": 6,
    "draftRecords": 2,
    "openNonDraftRecords": 4,
    "paginationComplete": true
  },
  "validation": {
    "schemaValid": true,
    "aggregateValid": true,
    "violations": []
  },
  "durationMs": 16,
  "limitations": [ ... ]
}
```

### Exit Codes:
| Code | Meaning |
|---:|---|
| `0` | Success (all validations passed, or controlled simulation caught expected violation) |
| `1` | Actual business rule violation |
| `2` | Configuration or usage error |
| `3` | Transport, HTTP, timeout, or rate-limit error |
| `4` | Wire-schema validation error |
| `5` | Security or pagination completeness error |

---

## Deliberate Non-Goals (Anti-Overengineering)

To keep the solution focused, maintainable, and aligned with Senior QA principles:
- **No Database / Cache**: Ephemeral verification without database migrations or storage state.
- **No Web Server / UI Framework**: CLI presentation runner provides clear, immediate terminal visualization.
- **No Broad Retry Framework**: Retrying schema validation or 4xx errors masks real defects. Transient retry is limited to specific operational policies.
- **No Author Ranking / Vanity Metrics**: Focus remains on contract integrity and business count accuracy.
