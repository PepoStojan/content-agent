import { BrandVoiceClient } from "@/app/(app)/brand-voice/brand-voice-client";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function BrandVoicePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("brand_profiles")
    .select("id, name, tone, reading_level, forbidden_phrases")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (
    <BrandVoiceClient
      profiles={(data ?? []).map((p) => ({
        id: p.id,
        name: p.name ?? "",
        tone: p.tone ?? "",
        reading_level: p.reading_level ?? "",
        forbidden_phrases: (p.forbidden_phrases ?? []).join(", "),
      }))}
      canEdit={canManageProfiles(profile.role)}
    />
  );
}
