export type ErrorCode =
  | "CONFIGURATION_ERROR"
  | "TRANSPORT_ERROR"
  | "HTTP_ERROR"
  | "SCHEMA_VALIDATION_ERROR"
  | "PAGINATION_ERROR"
  | "BUSINESS_RULE_VIOLATION";

export interface ErrorContext {
  readonly page?: number | undefined;
  readonly url?: string | undefined;
  readonly status?: number | undefined;
  readonly rateLimitRemaining?: number | string | undefined;
  readonly rateLimitReset?: number | string | undefined;
  readonly zodIssues?: string[] | undefined;
  readonly pullRequestId?: number | undefined;
  readonly ruleCode?: string | undefined;
}

export class QaChallengeError extends Error {
  readonly code: ErrorCode;
  readonly context: ErrorContext;

  constructor(code: ErrorCode, message: string, context: ErrorContext = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = "QaChallengeError";
    this.code = code;
    this.context = context;
  }
}

export class ConfigurationError extends QaChallengeError {
  constructor(message: string, context: ErrorContext = {}) {
    super("CONFIGURATION_ERROR", message, context);
    this.name = "ConfigurationError";
  }
}

export class TransportError extends QaChallengeError {
  constructor(message: string, context: ErrorContext = {}, options?: ErrorOptions) {
    super("TRANSPORT_ERROR", message, context, options);
    this.name = "TransportError";
  }
}

export class HttpError extends QaChallengeError {
  constructor(message: string, status: number, context: ErrorContext = {}) {
    super("HTTP_ERROR", message, { ...context, status });
    this.name = "HttpError";
  }
}

export class SchemaValidationError extends QaChallengeError {
  constructor(message: string, context: ErrorContext = {}) {
    super("SCHEMA_VALIDATION_ERROR", message, context);
    this.name = "SchemaValidationError";
  }
}

export class PaginationError extends QaChallengeError {
  constructor(message: string, context: ErrorContext = {}) {
    super("PAGINATION_ERROR", message, context);
    this.name = "PaginationError";
  }
}
