"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import { createClient } from "@/lib/supabase/client";

const ERROR_MESSAGES: Record<string, string> = {
  auth_code_error: "Sign-in didn't complete. Please try again.",
  session_exchange_failed: "We couldn't start your session. Please try again.",
};

export function SignInCard() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const redirectTo = searchParams.get("redirectTo") ?? "/";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam ? (ERROR_MESSAGES[errorParam] ?? "Something went wrong signing you in.") : null
  );

  async function handleSignIn() {
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
      },
    });
    if (signInError) {
      setError(signInError.message);
      setPending(false);
    }
    // On success the browser navigates away to Google, so no further
    // state update happens here.
  }

  return (
    <Card className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
      <div>
        <div className="mb-3 inline-flex size-9 items-center justify-center rounded-panel bg-primary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.2}>
            <path d="M4 19h16" />
            <path d="M6 15l4-6 4 3 4-8" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-text-primary">SEO Content Maker</h1>
        <p className="mt-1 text-sm text-text-muted">Sign in to continue</p>
      </div>

      {error ? (
        <div className="w-full rounded-panel bg-status-danger-bg px-3 py-2 text-sm text-status-danger-fg">
          {error}
        </div>
      ) : null}

      <Button className="w-full" onClick={handleSignIn} disabled={pending}>
        {pending ? "Redirecting to Google…" : "Sign in with Google"}
      </Button>
    </Card>
  );
}
