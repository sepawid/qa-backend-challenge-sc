import type { GitHubPullRequest } from "../../src/schemas/github-pull.schema.js";

/**
 * Multi-page GitHub Pull Requests fixture representing a deterministic 3-page response dataset.
 * Total records: 6 (4 open non-draft, 2 open draft).
 */
export const page1Fixture: GitHubPullRequest[] = [
  {
    id: 101,
    number: 1,
    state: "open",
    draft: false,
    title: "feat: add OAuth2 provider support",
    html_url: "https://github.com/appwrite/appwrite/pull/1",
    created_at: "2024-01-10T10:00:00Z",
    labels: [{ name: "feature" }],
  },
  {
    id: 102,
    number: 2,
    state: "open",
    draft: true, // draft
    title: "WIP: redesign database indexes",
    html_url: "https://github.com/appwrite/appwrite/pull/2",
    created_at: "2024-01-11T12:00:00Z",
    labels: [{ name: "wip" }],
  },
];

export const page2Fixture: GitHubPullRequest[] = [
  {
    id: 103,
    number: 3,
    state: "open",
    draft: false,
    title: "fix: resolve memory leak in streaming client",
    html_url: "https://github.com/appwrite/appwrite/pull/3",
    created_at: "2024-01-12T14:30:00Z",
    labels: [{ name: "bug" }, { name: "high-priority" }],
  },
  {
    id: 104,
    number: 4,
    state: "open",
    draft: false,
    title: "docs: update API quickstart guide",
    html_url: "https://github.com/appwrite/appwrite/pull/4",
    created_at: "2024-01-13T09:15:00Z",
    labels: [{ name: "documentation" }],
  },
];

export const page3Fixture: GitHubPullRequest[] = [
  {
    id: 105,
    number: 5,
    state: "open",
    draft: true, // draft
    title: "draft: experimental GraphQL federation",
    html_url: "https://github.com/appwrite/appwrite/pull/5",
    created_at: "2024-01-14T16:45:00Z",
    labels: [{ name: "experimental" }],
  },
  {
    id: 106,
    number: 6,
    state: "open",
    draft: false,
    title: "refactor: simplify container health check",
    html_url: "https://github.com/appwrite/appwrite/pull/6",
    created_at: "2024-01-15T11:20:00Z",
    labels: [{ name: "refactor" }],
  },
];

export const allFixturePullRequests: GitHubPullRequest[] = [
  ...page1Fixture,
  ...page2Fixture,
  ...page3Fixture,
];
