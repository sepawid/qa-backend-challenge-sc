import { z } from "zod";

export const githubPullRequestSchema = z
  .object({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    state: z.enum(["open", "closed"]),
    draft: z.boolean(),
    title: z.string(),
    html_url: z.string().url(),
    created_at: z.string().datetime({ offset: true }),
    labels: z.array(
      z
        .object({
          name: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const githubPullRequestPageSchema = z.array(githubPullRequestSchema);

export type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;
export type GitHubPullRequestPage = z.infer<typeof githubPullRequestPageSchema>;
