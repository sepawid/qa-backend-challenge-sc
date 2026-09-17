import { z } from "zod";

export const environmentConfigSchema = z.object({
  GITHUB_TOKEN: z
    .string()
    .trim()
    .min(1, "GITHUB_TOKEN cannot be empty if provided")
    .optional(),
  GITHUB_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val) return 10_000;
      const num = Number(val);
      if (!Number.isSafeInteger(num) || num < 500 || num > 300_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "GITHUB_TIMEOUT_MS must be an integer between 500 and 300000 ms",
        });
        return z.NEVER;
      }
      return num;
    }),
  GITHUB_MAX_PAGES: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val) return 20;
      const num = Number(val);
      if (!Number.isSafeInteger(num) || num < 1 || num > 500) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "GITHUB_MAX_PAGES must be an integer between 1 and 500",
        });
        return z.NEVER;
      }
      return num;
    }),
});

export const cliOptionsSchema = z.object({
  mode: z.enum(["fixture", "live"]).default("fixture"),
  format: z.enum(["human", "json"]).default("human"),
});

export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;
export type CliOptions = z.infer<typeof cliOptionsSchema>;

export function parseEnvironmentConfig(env: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const result = environmentConfigSchema.safeParse({
    GITHUB_TOKEN: env["GITHUB_TOKEN"] || undefined,
    GITHUB_TIMEOUT_MS: env["GITHUB_TIMEOUT_MS"] || undefined,
    GITHUB_MAX_PAGES: env["GITHUB_MAX_PAGES"] || undefined,
  });

  if (!result.success) {
    const errorDetails = result.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Invalid environment configuration: ${errorDetails}`);
  }

  return result.data;
}
