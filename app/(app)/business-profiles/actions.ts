"use server";

import { revalidatePath } from "next/cache";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface BusinessProfileInput {
  company: string;
  market: string;
  audience: string;
  services: string;
  conversion_goal: string;
  preferred_cta: string;
  prohibited_claims: string;
}

/**
 * Every mutation re-checks the role server-side before touching the
 * database, in addition to the RLS policies on business_profiles —
 * defense in depth, not a substitute for RLS.
 */
async function assertCanManage() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to manage business profiles.");
  }
  return profile;
}

export async function createBusinessProfile(input: BusinessProfileInput) {
  const profile = await assertCanManage();
  const supabase = await createClient();

  const { error } = await supabase.from("business_profiles").insert({
    organization_id: profile.organizationId,
    company: input.company,
    market: input.market || null,
    audience: input.audience || null,
    services: input.services || null,
    conversion_goal: input.conversion_goal || null,
    preferred_cta: input.preferred_cta || null,
    prohibited_claims: input.prohibited_claims || null,
    created_by: profile.userId,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/business-profiles");
}

export async function updateBusinessProfile(id: string, input: BusinessProfileInput) {
  await assertCanManage();
  const supabase = await createClient();

  const { error } = await supabase
    .from("business_profiles")
    .update({
      company: input.company,
      market: input.market || null,
      audience: input.audience || null,
      services: input.services || null,
      conversion_goal: input.conversion_goal || null,
      preferred_cta: input.preferred_cta || null,
      prohibited_claims: input.prohibited_claims || null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/business-profiles");
}

export async function deleteBusinessProfile(id: string) {
  await assertCanManage();
  const supabase = await createClient();

  const { error } = await supabase.from("business_profiles").delete().eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/business-profiles");
}
