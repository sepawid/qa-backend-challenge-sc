import type { GitHubPullRequest } from "../schemas/github-pull.schema.js";

/**
 * Filters pull requests that meet the business condition:
 * state is strictly "open" AND draft is strictly false.
 * Does not mutate the input array.
 */
export function filterOpenNonDraftPullRequests(
  pullRequests: readonly GitHubPullRequest[],
): GitHubPullRequest[] {
  return pullRequests.filter((pr) => pr.state === "open" && !pr.draft);
}

/**
 * Computes the final business count of pull requests.
 * Only pull requests in an OPEN state are included, and drafts are excluded.
 */
export function countOpenNonDraftPullRequests(
  pullRequests: readonly GitHubPullRequest[],
): number {
  return filterOpenNonDraftPullRequests(pullRequests).length;
}
