"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import {
  createBusinessProfile,
  deleteBusinessProfile,
  updateBusinessProfile,
  type BusinessProfileInput,
} from "@/app/(app)/business-profiles/actions";

interface BusinessProfile extends BusinessProfileInput {
  id: string;
}

const EMPTY_FORM: BusinessProfileInput = {
  company: "",
  market: "",
  audience: "",
  services: "",
  conversion_goal: "",
  preferred_cta: "",
  prohibited_claims: "",
};

type View =
  | { type: "list" }
  | { type: "create" }
  | { type: "detail"; id: string }
  | { type: "edit"; id: string };

function BusinessProfileForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: BusinessProfileInput;
  onCancel: () => void;
  onSubmit: (input: BusinessProfileInput) => Promise<void>;
}) {
  const [form, setForm] = useState<BusinessProfileInput>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function field(key: keyof BusinessProfileInput) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function handleSubmit() {
    setError(null);
    setPending(true);
    try {
      await onSubmit(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">Company</label>
          <input
            {...field("company")}
            className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">Market</label>
          <input
            {...field("market")}
            className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">Audience</label>
        <input
          {...field("audience")}
          className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">Services</label>
        <input
          {...field("services")}
          className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">Conversion goal</label>
          <input
            {...field("conversion_goal")}
            className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">Preferred CTA</label>
          <input
            {...field("preferred_cta")}
            className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">Prohibited claims</label>
        <textarea
          {...field("prohibited_claims")}
          rows={2}
          className="w-full resize-y rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
        />
      </div>

      {error ? <div className="rounded-panel bg-status-danger-bg px-3 py-2 text-sm text-status-danger-fg">{error}</div> : null}

      <div className="flex justify-end gap-2.5">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={pending || !form.company}>
          Save profile
        </Button>
      </div>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-0.5 text-xs text-text-muted">{label}</div>
      <div className="text-sm text-text-primary">{value || <span className="text-text-muted">Not specified</span>}</div>
    </div>
  );
}

function BusinessProfileDetail({
  profile,
  canEdit,
  onBack,
  onEdit,
  onDelete,
}: {
  profile: BusinessProfile;
  canEdit: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3.5">
        <div>
          <button onClick={onBack} className="mb-2 text-xs text-text-muted hover:text-text-primary">
            &larr; Business Profiles
          </button>
          <div className="text-lg font-semibold text-text-primary">{profile.company}</div>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onEdit}>
              Edit profile
            </Button>
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <DetailRow label="Market" value={profile.market} />
        <DetailRow label="Audience" value={profile.audience} />
        <DetailRow label="Services" value={profile.services} />
        <DetailRow label="Conversion goal" value={profile.conversion_goal} />
        <DetailRow label="Preferred CTA" value={profile.preferred_cta} />
      </div>
      <div className="border-t border-border pt-4">
        <DetailRow label="Prohibited claims" value={profile.prohibited_claims} />
      </div>
    </Card>
  );
}

export function BusinessProfilesClient({
  profiles,
  canEdit,
}: {
  profiles: BusinessProfile[];
  canEdit: boolean;
}) {
  const [view, setView] = useState<View>({ type: "list" });

  function findProfile(id: string) {
    return profiles.find((p) => p.id === id);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this business profile? This can't be undone.")) return;
    await deleteBusinessProfile(id);
    setView({ type: "list" });
  }

  // Referenced profile no longer exists (e.g. deleted elsewhere) —
  // fall back to a simple notice rather than setState during render.
  const notFound = (
    <div className="p-10">
      <Card className="flex flex-col items-start gap-3">
        <div className="text-sm text-text-secondary">This profile no longer exists.</div>
        <Button variant="outline" onClick={() => setView({ type: "list" })}>
          Back to Business Profiles
        </Button>
      </Card>
    </div>
  );

  if (view.type === "detail") {
    const profile = findProfile(view.id);
    if (!profile) return notFound;
    return (
      <div className="p-10">
        <BusinessProfileDetail
          profile={profile}
          canEdit={canEdit}
          onBack={() => setView({ type: "list" })}
          onEdit={() => setView({ type: "edit", id: profile.id })}
          onDelete={() => handleDelete(profile.id)}
        />
      </div>
    );
  }

  if (view.type === "edit") {
    const profile = findProfile(view.id);
    if (!profile) return notFound;
    return (
      <div className="p-10">
        <button
          onClick={() => setView({ type: "detail", id: profile.id })}
          className="mb-3 text-xs text-text-muted hover:text-text-primary"
        >
          &larr; {profile.company}
        </button>
        <BusinessProfileForm
          initial={profile}
          onCancel={() => setView({ type: "detail", id: profile.id })}
          onSubmit={async (input) => {
            await updateBusinessProfile(profile.id, input);
            setView({ type: "detail", id: profile.id });
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-10">
      <div className="mb-6 flex items-center justify-between gap-3.5">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Business Profiles</h1>
          <p className="text-sm text-text-muted">Reusable across every project.</p>
        </div>
        {canEdit ? (
          <Button onClick={() => setView({ type: "create" })}>+ New Business Profile</Button>
        ) : null}
      </div>

      {view.type === "create" ? (
        <div className="mb-5">
          <BusinessProfileForm
            initial={EMPTY_FORM}
            onCancel={() => setView({ type: "list" })}
            onSubmit={async (input) => {
              await createBusinessProfile(input);
              setView({ type: "list" });
            }}
          />
        </div>
      ) : null}

      {profiles.length === 0 && view.type !== "create" ? (
        <div className="py-16 text-center text-sm text-text-muted">No business profiles yet.</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => setView({ type: "detail", id: p.id })}
            className="text-left"
          >
            <Card className="flex h-full flex-col gap-2 transition-colors hover:border-primary">
              <div className="text-[14.5px] font-semibold text-text-primary">{p.company}</div>
              <div className="text-[12.5px] text-text-secondary">{p.audience}</div>
              <div className="font-mono text-[11.5px] text-text-muted">
                {p.market} · {p.services}
              </div>
              <div className="mt-1 text-xs text-text-secondary">
                Goal: <strong>{p.conversion_goal}</strong>
              </div>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
