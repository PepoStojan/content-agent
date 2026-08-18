import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges the OAuth code Supabase/Google redirected back with for a
 * session. Graceful failure: any missing code or exchange error sends
 * the user back to /sign-in with a query param the sign-in card knows
 * how to render as a message, rather than a raw error page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=auth_code_error`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=session_exchange_failed`
    );
  }

  const safeRedirect = redirectTo.startsWith("/") ? redirectTo : "/";
  return NextResponse.redirect(`${origin}${safeRedirect}`);
}
