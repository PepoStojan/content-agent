import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * Service-role Supabase client. Bypasses RLS — server-only, never
 * imported from a Client Component (the `server-only` import above
 * throws a build error if that happens). Reserve for background jobs
 * (Vercel Workflow steps) that must act outside a user's own row
 * access, e.g. writing generation_runs status. Prefer the RLS-bound
 * server client (lib/supabase/server.ts) for anything request-scoped.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
