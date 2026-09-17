import type { AggregateResponse } from "../../src/schemas/aggregate.schema.js";

/**
 * Fixture scenario violating Part 2 rule:
 * A pull request has the label "high-priority", but meta.is_draft is true.
 */
export const aggregateHighPriorityDraftFixture: AggregateResponse = {
  product_id: "appwrite-001",
  total_open_prs: 2,
  last_updated: "2024-03-20T15:30:00Z",
  pull_requests: [
    {
      id: 1024,
      title: "feat: add SQS support to testing commons",
      author: { username: "nej.jissard", role: "admin" },
      status: "OPEN",
      labels: ["backend", "high-priority"],
      meta: { is_draft: true, review_comments: 5 }, // VIOLATION
    },
    {
      id: 1025,
      title: "fix: resolve memory leak in connection pool",
      author: { username: "dev.user", role: "contributor" },
      status: "OPEN",
      labels: ["backend"],
      meta: { is_draft: false, review_comments: 1 },
    },
  ],
};
