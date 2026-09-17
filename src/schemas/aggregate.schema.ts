import { z } from "zod";

export const aggregateAuthorSchema = z.object({
  username: z.string().min(1),
  role: z.string().min(1),
});

export const aggregatePullRequestMetaSchema = z.object({
  is_draft: z.boolean(),
  review_comments: z.number().int().nonnegative(),
});

export const aggregatePullRequestSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  author: aggregateAuthorSchema,
  status: z.string().min(1),
  labels: z.array(z.string()),
  meta: aggregatePullRequestMetaSchema,
});

export const aggregateResponseSchema = z.object({
  product_id: z.string().min(1),
  total_open_prs: z.number().int().nonnegative(),
  last_updated: z.string().datetime({ offset: true }),
  pull_requests: z.array(aggregatePullRequestSchema),
});

export type AggregateAuthor = z.infer<typeof aggregateAuthorSchema>;
export type AggregatePullRequestMeta = z.infer<typeof aggregatePullRequestMetaSchema>;
export type AggregatePullRequest = z.infer<typeof aggregatePullRequestSchema>;
export type AggregateResponse = z.infer<typeof aggregateResponseSchema>;
