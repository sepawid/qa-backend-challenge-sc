import type { AggregateResponse } from "../../src/schemas/aggregate.schema.js";

/**
 * The exact sample JSON payload provided in Part 2 of the challenge specification.
 */
export const sampleAggregateResponse: AggregateResponse = {
  product_id: "appwrite-001",
  total_open_prs: 1,
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
