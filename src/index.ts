export {
  GitHubPullRequestClient,
  type GitHubClientOptions,
  type FetchAllResult,
  type PageFetchedEvent,
  type RateLimitInfo,
} from "./core/github-client.js";

export {
  parseLinkHeader,
  getNextLink,
  type LinkRelation,
} from "./core/link-header.js";

export {
  QaChallengeError,
  ConfigurationError,
  TransportError,
  HttpError,
  SchemaValidationError,
  PaginationError,
  type ErrorCode,
  type ErrorContext,
} from "./core/errors.js";

export {
  githubPullRequestSchema,
  githubPullRequestPageSchema,
  type GitHubPullRequest,
  type GitHubPullRequestPage,
} from "./schemas/github-pull.schema.js";

export {
  aggregateResponseSchema,
  aggregatePullRequestSchema,
  aggregateAuthorSchema,
  aggregatePullRequestMetaSchema,
  type AggregateResponse,
  type AggregatePullRequest,
} from "./schemas/aggregate.schema.js";

export {
  countOpenNonDraftPullRequests,
  filterOpenNonDraftPullRequests,
} from "./business/pull-request-monitor.js";

export {
  validateAggregateRules,
  assertAggregateRules,
  AggregateRuleError,
  type AggregateViolation,
  type AggregateValidationResult,
} from "./business/aggregate-rules.js";

export {
  buildRunResult,
  type RunResult,
} from "./presentation/presentation-model.js";
