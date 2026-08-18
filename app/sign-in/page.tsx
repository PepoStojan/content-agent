import { Suspense } from "react";

import { SignInCard } from "@/app/sign-in/sign-in-card";

/**
 * Phase 1 addition — Design V1 did not design a sign-in screen (its
 * screen list starts at Dashboard). Built here using only existing
 * Design V1 tokens/components (Card, brand teal, Poppins) rather than
 * inventing new visual language. Flag for design sign-off if a fuller
 * treatment is wanted later.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Suspense fallback={null}>
        <SignInCard />
      </Suspense>
    </main>
  );
}
