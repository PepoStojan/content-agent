import "server-only";

import { z } from "zod";

/**
 * Validates required server-side environment variables at boot,
 * rather than failing deep inside a generation run with an unclear
 * error. Import `serverEnv` (not `process.env` directly) from any
 * server-only module that needs these.
 */
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1),
  SENTRY_DSN: z.string().url().optional(),
});

export const serverEnv = serverEnvSchema.parse(process.env);
