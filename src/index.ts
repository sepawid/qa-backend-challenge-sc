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
  resolveNextLink,
  type LinkRelation,
  type ResolvedNextLink,
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
  type SimulationResult,
  type RunErrorDetails,
} from "./presentation/presentation-model.js";

export {
  parseCliArgs,
  runShowcase,
  mapErrorToExitCode,
  detectRequestedOutput,
  describeError,
  buildErrorResult,
  type CliArguments,
  type ShowcaseDeps,
  type BuildErrorResultParams,
} from "./presentation/cli.js";

export {
  TerminalFormatter,
  type FormatterOptions,
} from "./presentation/formatter.js";

export {
  parseEnvironmentConfig,
  environmentConfigSchema,
  cliOptionsSchema,
  type EnvironmentConfig,
  type CliOptions,
} from "./schemas/config.schema.js";

