"use server";

import { revalidatePath } from "next/cache";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface BrandProfileInput {
  name: string;
  tone: string;
  reading_level: string;
  forbidden_phrases: string;
}

function parseForbidden(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function assertCanManage() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to manage brand voice profiles.");
  }
  return profile;
}

export async function createBrandProfile(input: BrandProfileInput) {
  const profile = await assertCanManage();
  const supabase = await createClient();

  const { error } = await supabase.from("brand_profiles").insert({
    organization_id: profile.organizationId,
    name: input.name,
    tone: input.tone || null,
    reading_level: input.reading_level || null,
    forbidden_phrases: parseForbidden(input.forbidden_phrases),
    // Not user-editable in V1 — matches Design V1's own prototype
    // behavior, which always hardcoded this rather than exposing it.
    spelling_locale: "US",
    em_dash_forbidden: true,
    created_by: profile.userId,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/brand-voice");
}

export async function updateBrandProfile(id: string, input: BrandProfileInput) {
  await assertCanManage();
  const supabase = await createClient();

  const { error } = await supabase
    .from("brand_profiles")
    .update({
      name: input.name,
      tone: input.tone || null,
      reading_level: input.reading_level || null,
      forbidden_phrases: parseForbidden(input.forbidden_phrases),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/brand-voice");
}

export async function deleteBrandProfile(id: string) {
  await assertCanManage();
  const supabase = await createClient();

  const { error } = await supabase.from("brand_profiles").delete().eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/brand-voice");
}
