import type { AggregateResponse } from "../../src/schemas/aggregate.schema.js";

/**
 * Fixture scenario violating Part 2 integrity rule:
 * total_open_prs is 3, but pull_requests array contains only 1 item.
 */
export const aggregateCountMismatchFixture: AggregateResponse = {
  product_id: "appwrite-001",
  total_open_prs: 3, // MISMATCH with pull_requests.length (1)
  last_updated: "2024-03-20T15:30:00Z",
  pull_requests: [
    {
      id: 1024,
      title: "feat: add SQS support to testing commons",
      author: { username: "nej.jissard", role: "admin" },
      status: "OPEN",
      labels: ["backend", "high-priority"],
      meta: { is_draft: false, review_comments: 5 },
    },
  ],
};
