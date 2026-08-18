import { BusinessProfilesClient } from "@/app/(app)/business-profiles/business-profiles-client";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function BusinessProfilesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("business_profiles")
    .select("id, company, market, audience, services, conversion_goal, preferred_cta, prohibited_claims")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (
    <BusinessProfilesClient
      profiles={(data ?? []).map((p) => ({
        id: p.id,
        company: p.company ?? "",
        market: p.market ?? "",
        audience: p.audience ?? "",
        services: p.services ?? "",
        conversion_goal: p.conversion_goal ?? "",
        preferred_cta: p.preferred_cta ?? "",
        prohibited_claims: p.prohibited_claims ?? "",
      }))}
      canEdit={canManageProfiles(profile.role)}
    />
  );
}
