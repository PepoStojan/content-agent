"use server";

import { redirect } from "next/navigation";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { parseMarkdownResearch } from "@/lib/ingestion/markdown-research-parser";
import { createClient } from "@/lib/supabase/server";
import { FILE_LIMITS, type ProjectFileType } from "@/lib/validation/file-limits";

async function assertCanCreate() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to create content.");
  }
  return profile;
}

export interface BasicsInput {
  contentType: "blog_post" | "landing_page" | "comparison_page" | "guide";
  topic: string;
  targetQuery: string;
  market: string;
}

/**
 * Creates the draft project row as soon as Basics is complete, rather
 * than only at the final "Create project" step — project_files and
 * research_packages both require a real project_id, and Design V1's
 * upload steps happen before the wizard's final step.
 */
export async function ensureDraftProject(input: BasicsInput, existingId: string | null) {
  const profile = await assertCanCreate();
  const supabase = await createClient();

  if (existingId) {
    const { error } = await supabase
      .from("projects")
      .update({
        name: input.topic,
        content_type: input.contentType,
        primary_topic: input.topic,
        target_query: input.targetQuery || null,
        market: input.market || null,
      })
      .eq("id", existingId);
    if (error) throw new Error(error.message);
    return existingId;
  }

  // Explicit client-generated id, and no .select()/RETURNING on the
  // insert — avoids the RETURNING-triggered SELECT-policy recursion
  // that caused the original RLS failure here.
  const projectId = crypto.randomUUID();

  const { error } = await supabase.from("projects").insert({
    id: projectId,
    organization_id: profile.organizationId,
    name: input.topic,
    content_type: input.contentType,
    primary_topic: input.topic,
    target_query: input.targetQuery || null,
    market: input.market || null,
    status: "draft",
    created_by: profile.userId,
  });

  if (error) throw new Error(error.message);

  const { error: memberError } = await supabase
    .from("project_members")
    .insert({ project_id: projectId, user_id: profile.userId, added_by: profile.userId });
  if (memberError) throw new Error(memberError.message);

  return projectId;
}

function fileTypeFor(name: string): ProjectFileType {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  if (ext === ".csv") return "research_csv";
  if (ext === ".md" || ext === ".markdown") return "research_markdown";
  if (ext === ".doc" || ext === ".docx") return "research_docx";
  throw new Error("Unsupported research file type.");
}

function validateFile(file: File, type: ProjectFileType) {
  const limits = FILE_LIMITS[type];
  if (file.size > limits.maxBytes) {
    throw new Error(`File exceeds the ${(limits.maxBytes / (1024 * 1024)).toFixed(0)}MB limit for this format.`);
  }
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!(limits.extensions as readonly string[]).includes(ext)) {
    throw new Error("File extension not accepted for this format.");
  }
}

export async function uploadResearchFile(projectId: string, formData: FormData) {
  const profile = await assertCanCreate();
  const supabase = await createClient();
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file provided.");

  const fileType = fileTypeFor(file.name);
  validateFile(file, fileType);

  const storagePath = `${projectId}/research/${Date.now()}-${file.name}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("project-files")
    .upload(storagePath, bytes, { contentType: file.type || undefined });
  if (uploadError) throw new Error(uploadError.message);

  const { data: fileRow, error: fileError } = await supabase
    .from("project_files")
    .insert({
      project_id: projectId,
      file_type: fileType,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      storage_path: storagePath,
      uploaded_by: profile.userId,
      validation_status: "valid",
    })
    .select("id")
    .single();
  if (fileError) throw new Error(fileError.message);

  const { data: pkg, error: pkgError } = await supabase
    .from("research_packages")
    .insert({ project_id: projectId, project_file_id: fileRow.id, status: "parsing" })
    .select("id")
    .single();
  if (pkgError) throw new Error(pkgError.message);

  await supabase.from("projects").update({ status: "ingesting", current_research_package_id: pkg.id }).eq("id", projectId);

  if (fileType === "research_markdown") {
    // Real parser — see lib/ingestion/markdown-research-parser.ts.
    const text = new TextDecoder("utf-8").decode(bytes);
    const { sources, summary } = parseMarkdownResearch(text);

    if (sources.length > 0) {
      const { error: sourcesError } = await supabase
        .from("research_sources")
        .insert(sources.map((s) => ({ research_package_id: pkg.id, type: s.type, payload: s.payload })));
      if (sourcesError) throw new Error(sourcesError.message);
    }

    // Topic precedence rule (Architecture V1): the project's own topic
    // is authoritative and is never overwritten by research metadata.
    // A conflict is only recorded and surfaced as a warning.
    const { data: project } = await supabase
      .from("projects")
      .select("primary_topic")
      .eq("id", projectId)
      .single();

    const projectTopic = (project?.primary_topic ?? "").trim().toLowerCase();
    const researchTopic = (summary.topic ?? "").trim().toLowerCase();
    const topicConflict = Boolean(researchTopic) && researchTopic !== projectTopic;

    await supabase
      .from("research_packages")
      .update({
        status: "parsed",
        parsed_summary: summary,
        topic_conflict_flag: topicConflict,
        topic_conflict_details: topicConflict
          ? { projectTopic: project?.primary_topic ?? null, researchTopic: summary.topic }
          : null,
      })
      .eq("id", pkg.id);

    return {
      status: "parsed" as const,
      summary,
      topicConflict: topicConflict
        ? { projectTopic: project?.primary_topic ?? "", researchTopic: summary.topic ?? "" }
        : null,
    };
  }

  // CSV / DOC/DOCX: no real sample to parse against yet. File is
  // genuinely stored, but normalization is simulated rather than real
  // — decision #3, until real samples are provided.
  const simulatedSummary = {
    competitorCount: 0,
    contentGapCount: 0,
    serpFeatureCount: 0,
    warningCount: 1,
    topic: null,
    primaryQuery: null,
    note: "Automatic parsing for this format isn't implemented yet — file stored for manual review.",
  };
  await supabase
    .from("research_packages")
    .update({ status: "parsed", parsed_summary: simulatedSummary })
    .eq("id", pkg.id);

  return { status: "parsed" as const, summary: simulatedSummary, topicConflict: null };
}

export async function uploadWebsiteFiles(
  projectId: string,
  formData: FormData
): Promise<{ status: "parsed" | "failed"; error?: string }> {
  const profile = await assertCanCreate();
  const supabase = await createClient();

  const sitemapFile = formData.get("sitemap") as File | null;
  const screamingFrogFile = formData.get("screamingFrog") as File | null;
  if (!sitemapFile && !screamingFrogFile) throw new Error("No file provided.");

  let sitemapFileId: string | null = null;
  let sfFileId: string | null = null;

  try {
    if (sitemapFile) {
      validateFile(sitemapFile, "sitemap_xml");
      const path = `${projectId}/website/${Date.now()}-${sitemapFile.name}`;
      const bytes = new Uint8Array(await sitemapFile.arrayBuffer());
      const { error } = await supabase.storage
        .from("project-files")
        .upload(path, bytes, { contentType: sitemapFile.type || undefined });
      if (error) throw new Error(error.message);
      const { data, error: rowError } = await supabase
        .from("project_files")
        .insert({
          project_id: projectId,
          file_type: "sitemap_xml",
          file_name: sitemapFile.name,
          mime_type: sitemapFile.type || null,
          size_bytes: sitemapFile.size,
          storage_path: path,
          uploaded_by: profile.userId,
          validation_status: "valid",
        })
        .select("id")
        .single();
      if (rowError) throw new Error(rowError.message);
      sitemapFileId = data.id;
    }

    if (screamingFrogFile) {
      validateFile(screamingFrogFile, "screaming_frog_csv");
      const path = `${projectId}/website/${Date.now()}-${screamingFrogFile.name}`;
      const bytes = new Uint8Array(await screamingFrogFile.arrayBuffer());
      const { error } = await supabase.storage
        .from("project-files")
        .upload(path, bytes, { contentType: screamingFrogFile.type || undefined });
      if (error) throw new Error(error.message);
      const { data, error: rowError } = await supabase
        .from("project_files")
        .insert({
          project_id: projectId,
          file_type: "screaming_frog_csv",
          file_name: screamingFrogFile.name,
          mime_type: screamingFrogFile.type || null,
          size_bytes: screamingFrogFile.size,
          storage_path: path,
          uploaded_by: profile.userId,
          validation_status: "valid",
        })
        .select("id")
        .single();
      if (rowError) throw new Error(rowError.message);
      sfFileId = data.id;
    }
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "Upload failed." };
  }

  const { data: dataset, error: datasetError } = await supabase
    .from("website_datasets")
    .insert({
      project_id: projectId,
      sitemap_project_file_id: sitemapFileId,
      screaming_frog_project_file_id: sfFileId,
      status: "parsed",
      // No real sitemap/Screaming Frog sample exists yet — simulated,
      // same as CSV/DOCX research, decision #3/#7.
      parsed_summary: {
        note: "Automatic parsing for website knowledge isn't implemented yet — files stored for manual review.",
      },
    })
    .select("id")
    .single();
  if (datasetError) return { status: "failed", error: datasetError.message };

  await supabase.from("projects").update({ current_website_dataset_id: dataset.id }).eq("id", projectId);

  return { status: "parsed" };
}

export interface FinalizeInput {
  businessProfileId: string | null;
  brandProfileId: string | null;
  instructions: string;
}

export async function finalizeProject(projectId: string, input: FinalizeInput) {
  await assertCanCreate();
  const supabase = await createClient();

  const { error } = await supabase
    .from("projects")
    .update({
      business_profile_id: input.businessProfileId,
      brand_profile_id: input.brandProfileId,
      instructions: input.instructions || null,
      status: "ready_for_brief",
    })
    .eq("id", projectId);

  if (error) throw new Error(error.message);

  redirect(`/projects/${projectId}`);
}
