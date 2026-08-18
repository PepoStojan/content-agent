"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import { Chip } from "@/components/design-system/chip";
import { Stepper } from "@/components/design-system/stepper";
import {
  ensureDraftProject,
  finalizeProject,
  uploadResearchFile,
  uploadWebsiteFiles,
  type BasicsInput,
} from "@/app/(app)/new-content/actions";

const CONTENT_TYPES: { value: BasicsInput["contentType"]; label: string }[] = [
  { value: "blog_post", label: "Blog post" },
  { value: "landing_page", label: "Landing page" },
  { value: "comparison_page", label: "Comparison page" },
  { value: "guide", label: "Guide" },
];

const STEPS = [
  { label: "Basics" },
  { label: "Research" },
  { label: "Website knowledge" },
  { label: "Profiles" },
  { label: "Review" },
];

type UploadStatus = "idle" | "uploading" | "parsed" | "failed";

interface BizChip { id: string; company: string }
interface BrandChip { id: string; name: string }

/**
 * One fully independent upload section for the Website Knowledge
 * step (XML Sitemap, Screaming Frog internal_all.csv). Each instance
 * owns its own status/filename/error — uploading one never touches
 * the other. Status flow: Waiting → Uploading → Uploaded/Failed.
 */
function WebsiteUploadSection({
  title,
  description,
  accept,
  status,
  fileName,
  error,
  onFile,
  onRetry,
}: {
  title: string;
  description: string;
  accept: string;
  status: UploadStatus;
  fileName: string | null;
  error: string | null;
  onFile: (file: File) => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="text-xs text-text-muted">{description}</div>
      </div>

      {status === "idle" ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-8 text-center">
          <div className="text-sm text-text-secondary">Drag &amp; drop a file here, or</div>
          <input
            type="file"
            accept={accept}
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </Card>
      ) : null}

      {status === "uploading" ? (
        <Card className="flex items-center gap-3">
          <div className="size-4 animate-spin rounded-pill border-2 border-border border-t-primary" />
          <span className="text-sm text-text-secondary">Uploading {fileName}&hellip;</span>
        </Card>
      ) : null}

      {status === "parsed" ? (
        <Card className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-primary">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-sm font-semibold text-text-primary">{fileName} uploaded</span>
        </Card>
      ) : null}

      {status === "failed" ? (
        <div className="flex items-center justify-between rounded-panel border border-status-danger-bg bg-status-danger-bg px-3.5 py-3">
          <span className="text-sm text-status-danger-fg">{error ?? "Upload failed."}</span>
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function NewContentWizard({
  businessProfiles,
  brandProfiles,
}: {
  businessProfiles: BizChip[];
  brandProfiles: BrandChip[];
}) {
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [basics, setBasics] = useState<BasicsInput>({
    contentType: "blog_post",
    topic: "",
    targetQuery: "",
    market: "United States",
  });

  const [researchStatus, setResearchStatus] = useState<UploadStatus>("idle");
  const [researchFileName, setResearchFileName] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchSummary, setResearchSummary] = useState<{
    competitorCount: number;
    contentGapCount: number;
    serpFeatureCount: number;
    warningCount: number;
  } | null>(null);
  const [topicConflict, setTopicConflict] = useState<{ projectTopic: string; researchTopic: string } | null>(null);

  // Sitemap and Screaming Frog uploads are fully independent — each
  // has its own status/filename/error, and uploading one never
  // touches the other's state.
  const [sitemapStatus, setSitemapStatus] = useState<UploadStatus>("idle");
  const [sitemapFileName, setSitemapFileName] = useState<string | null>(null);
  const [sitemapError, setSitemapError] = useState<string | null>(null);

  const [screamingFrogStatus, setScreamingFrogStatus] = useState<UploadStatus>("idle");
  const [screamingFrogFileName, setScreamingFrogFileName] = useState<string | null>(null);
  const [screamingFrogError, setScreamingFrogError] = useState<string | null>(null);

  const [businessProfileId, setBusinessProfileId] = useState<string | null>(businessProfiles[0]?.id ?? null);
  const [brandProfileId, setBrandProfileId] = useState<string | null>(brandProfiles[0]?.id ?? null);
  const [instructions, setInstructions] = useState("");

  async function handleNext() {
    if (step === 0) {
      setSaving(true);
      try {
        const id = await ensureDraftProject(basics, projectId);
        setProjectId(id);
        setStep(1);
      } catch (e) {
        setResearchError(e instanceof Error ? e.message : "Couldn't save basics.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (step === 4) {
      setSaving(true);
      try {
        await finalizeProject(projectId!, { businessProfileId, brandProfileId, instructions });
      } catch (e) {
        // finalizeProject redirects on success — an error here is real.
        setSaving(false);
        alert(e instanceof Error ? e.message : "Couldn't create project.");
      }
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  }

  // Selecting/dropping a file starts upload + parsing immediately —
  // the file is passed in directly from the input's onChange rather
  // than read back from state/ref later, so there's no dependency on
  // a later re-render or event to kick things off.
  async function startResearchUpload(file: File) {
    if (!projectId) return;
    setResearchFileName(file.name);
    setResearchStatus("uploading");
    setResearchError(null);
    const formData = new FormData();
    formData.set("file", file);
    try {
      const result = await uploadResearchFile(projectId, formData);
      setResearchStatus("parsed");
      setResearchSummary(result.summary);
      setTopicConflict(result.topicConflict ?? null);
    } catch (e) {
      setResearchStatus("failed");
      setResearchError(e instanceof Error ? e.message : "Could not parse file.");
    }
  }

  // Each call sends only its own file — the two sections never share
  // a request, so one can never affect the other's outcome.
  async function startSitemapUpload(file: File) {
    if (!projectId) return;
    setSitemapFileName(file.name);
    setSitemapStatus("uploading");
    setSitemapError(null);
    const formData = new FormData();
    formData.set("sitemap", file);
    const result = await uploadWebsiteFiles(projectId, formData);
    if (result.status === "failed") {
      setSitemapStatus("failed");
      setSitemapError(result.error ?? "Upload failed.");
    } else {
      setSitemapStatus("parsed");
    }
  }

  async function startScreamingFrogUpload(file: File) {
    if (!projectId) return;
    setScreamingFrogFileName(file.name);
    setScreamingFrogStatus("uploading");
    setScreamingFrogError(null);
    const formData = new FormData();
    formData.set("screamingFrog", file);
    const result = await uploadWebsiteFiles(projectId, formData);
    if (result.status === "failed") {
      setScreamingFrogStatus("failed");
      setScreamingFrogError(result.error ?? "Upload failed.");
    } else {
      setScreamingFrogStatus("parsed");
    }
  }

  const nextDisabled =
    saving ||
    (step === 0 && !basics.topic) ||
    (step === 1 && researchStatus !== "parsed");

  return (
    <div className="mx-auto max-w-3xl p-10">
      <h1 className="mb-5 text-xl font-semibold text-text-primary">New Content</h1>
      <Stepper steps={STEPS} currentIndex={step} className="mb-7" />

      {step === 0 ? (
        <div className="flex flex-col gap-4.5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Content type</label>
            <div className="flex flex-wrap gap-2">
              {CONTENT_TYPES.map((opt) => (
                <Chip
                  key={opt.value}
                  selected={basics.contentType === opt.value}
                  onClick={() => setBasics((b) => ({ ...b, contentType: opt.value }))}
                >
                  {opt.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Topic</label>
            <input
              value={basics.topic}
              onChange={(e) => setBasics((b) => ({ ...b, topic: e.target.value }))}
              placeholder="e.g. best project management software for remote teams"
              className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Primary target query</label>
              <input
                value={basics.targetQuery}
                onChange={(e) => setBasics((b) => ({ ...b, targetQuery: e.target.value }))}
                className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Market</label>
              <input
                value={basics.market}
                onChange={(e) => setBasics((b) => ({ ...b, market: e.target.value }))}
                className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
              />
            </div>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-3.5">
          <p className="text-sm text-text-secondary">
            Upload the Research Agent&rsquo;s output for this topic. Accepts CSV, Markdown or DOC/DOCX.
          </p>

          {researchStatus === "idle" ? (
            <Card className="flex flex-col items-center gap-3 border-dashed py-9 text-center">
              <div className="text-sm text-text-secondary">Drop a file here, or</div>
              <input
                type="file"
                accept=".csv,.md,.markdown,.doc,.docx"
                className="text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) startResearchUpload(file);
                }}
              />
            </Card>
          ) : null}

          {researchStatus === "uploading" ? (
            <Card className="flex items-center gap-3">
              <div className="size-4 animate-spin rounded-pill border-2 border-border border-t-primary" />
              <span className="text-sm text-text-secondary">
                Parsing {researchFileName ?? "file"}&hellip;
              </span>
            </Card>
          ) : null}

          {researchStatus === "parsed" && researchSummary ? (
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-primary">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="text-sm font-semibold text-text-primary">File parsed</span>
              </div>
              <div className="grid grid-cols-4 gap-3 font-mono">
                <div>
                  <div className="text-lg font-semibold">{researchSummary.competitorCount}</div>
                  <div className="font-sans text-[11px] text-text-muted">competitors</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{researchSummary.contentGapCount}</div>
                  <div className="font-sans text-[11px] text-text-muted">content gaps</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{researchSummary.serpFeatureCount}</div>
                  <div className="font-sans text-[11px] text-text-muted">SERP features</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-status-warning-fg">{researchSummary.warningCount}</div>
                  <div className="font-sans text-[11px] text-text-muted">warnings</div>
                </div>
              </div>
            </Card>
          ) : null}

          {topicConflict ? (
            <div className="rounded-panel border border-status-warning-bg bg-status-warning-bg px-3.5 py-3 text-sm text-status-warning-fg">
              <div className="mb-1 font-semibold">Research topic doesn&rsquo;t match your project topic</div>
              <div>Project topic: &ldquo;{topicConflict.projectTopic}&rdquo;</div>
              <div>Research file topic: &ldquo;{topicConflict.researchTopic}&rdquo;</div>
              <div className="mt-1 text-xs">
                Your project topic is kept. Review the research file if this looks wrong.
              </div>
            </div>
          ) : null}

          {researchStatus === "failed" ? (
            <div className="flex items-center justify-between rounded-panel border border-status-danger-bg bg-status-danger-bg px-3.5 py-3">
              <span className="text-sm text-status-danger-fg">{researchError ?? "Could not parse file."}</span>
              <Button variant="outline" onClick={() => setResearchStatus("idle")}>
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-5">
          <WebsiteUploadSection
            title="XML Sitemap (Optional)"
            description="Upload your website sitemap.xml file."
            accept=".xml"
            status={sitemapStatus}
            fileName={sitemapFileName}
            error={sitemapError}
            onFile={startSitemapUpload}
            onRetry={() => setSitemapStatus("idle")}
          />
          <WebsiteUploadSection
            title="Screaming Frog internal_all.csv (Optional)"
            description="Upload the Screaming Frog Internal All export."
            accept=".csv"
            status={screamingFrogStatus}
            fileName={screamingFrogFileName}
            error={screamingFrogError}
            onFile={startScreamingFrogUpload}
            onRetry={() => setScreamingFrogStatus("idle")}
          />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-5">
          <div>
            <label className="mb-2 block text-xs font-medium text-text-secondary">Business profile</label>
            <div className="flex flex-wrap gap-2">
              {businessProfiles.map((p) => (
                <Chip key={p.id} selected={businessProfileId === p.id} onClick={() => setBusinessProfileId(p.id)}>
                  {p.company}
                </Chip>
              ))}
              {businessProfiles.length === 0 ? (
                <span className="text-sm text-text-muted">No business profiles yet.</span>
              ) : null}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-text-secondary">Brand voice</label>
            <div className="flex flex-wrap gap-2">
              {brandProfiles.map((p) => (
                <Chip key={p.id} selected={brandProfileId === p.id} onClick={() => setBrandProfileId(p.id)}>
                  {p.name}
                </Chip>
              ))}
              {brandProfiles.length === 0 ? (
                <span className="text-sm text-text-muted">No brand voice profiles yet.</span>
              ) : null}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">
              Project-specific instructions (optional)
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
            />
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">Review before creating the project.</p>
          <Card className="flex flex-col gap-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Topic</span>
              <span className="font-medium">{basics.topic || "(not set)"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Content type</span>
              <span className="font-medium">{CONTENT_TYPES.find((c) => c.value === basics.contentType)?.label}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Market</span>
              <span className="font-medium">{basics.market}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Business profile</span>
              <span className="font-medium">
                {businessProfiles.find((p) => p.id === businessProfileId)?.company ?? "None"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Brand voice</span>
              <span className="font-medium">{brandProfiles.find((p) => p.id === brandProfileId)?.name ?? "None"}</span>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-8 flex justify-between border-t border-border pt-5">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || saving}>
          Back
        </Button>
        <Button onClick={handleNext} disabled={nextDisabled}>
          {saving ? "Saving…" : step === 4 ? "Create project" : "Next"}
        </Button>
      </div>
    </div>
  );
}
