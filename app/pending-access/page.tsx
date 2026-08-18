import { Card } from "@/components/design-system/card";
import { Button } from "@/components/ui/button";

/**
 * Phase 2 addition — not in Design V1 (which has no concept of
 * unprovisioned users). Shown when a signed-in user has no `profiles`
 * row yet. V1 provisioning is manual, so this is a dead end until a
 * Team Lead adds them — the only action available is signing out.
 */
export default function PendingAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-semibold text-text-primary">Pending access</h1>
        <p className="text-sm text-text-secondary">
          You&rsquo;re signed in, but your account hasn&rsquo;t been added to a
          workspace yet. Ask your Team Lead to grant you access.
        </p>
        <form action="/auth/sign-out" method="post">
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </Card>
    </main>
  );
}
