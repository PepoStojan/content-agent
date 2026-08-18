import { NewContentWizard } from "@/app/(app)/new-content/new-content-wizard";
import { Card } from "@/components/design-system/card";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function NewContentPage() {
  const profile = await requireProfile();

  if (!canManageProfiles(profile.role)) {
    return (
      <div className="p-10">
        <Card className="max-w-md">
          <p className="text-sm text-text-secondary">
            You don&rsquo;t have permission to create content. Ask your Team Lead or SEO Manager.
          </p>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: businessProfiles }, { data: brandProfiles }] = await Promise.all([
    supabase.from("business_profiles").select("id, company").order("created_at", { ascending: false }),
    supabase.from("brand_profiles").select("id, name").order("created_at", { ascending: false }),
  ]);

  return (
    <NewContentWizard
      businessProfiles={businessProfiles ?? []}
      brandProfiles={brandProfiles ?? []}
    />
  );
}
