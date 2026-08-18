"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import {
  createBrandProfile,
  deleteBrandProfile,
  updateBrandProfile,
  type BrandProfileInput,
} from "@/app/(app)/brand-voice/actions";

interface BrandProfile extends BrandProfileInput {
  id: string;
}

const EMPTY_FORM: BrandProfileInput = {
  name: "",
  tone: "",
  reading_level: "",
  forbidden_phrases: "",
};

type View =
  | { type: "list" }
  | { type: "create" }
  | { type: "detail"; id: string }
  | { type: "edit"; id: string };

function BrandProfileForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: BrandProfileInput;
  onCancel: () => void;
  onSubmit: (input: BrandProfileInput) => Promise<void>;
}) {
  const [form, setForm] = useState<BrandProfileInput>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function field(key: keyof BrandProfileInput) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
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
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">Profile name</label>
          <input
            {...field("name")}
            className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">Reading level</label>
          <input
            {...field("reading_level")}
            className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">Tone</label>
        <input
          {...field("tone")}
          className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">
          Forbidden phrases (comma separated)
        </label>
        <input
          {...field("forbidden_phrases")}
          className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div className="flex items-center gap-2 rounded-[8px] border border-status-success-bg bg-status-success-bg px-3 py-2.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-status-success-fg">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="text-[12.5px] text-status-success-fg">
          Never use an em dash — system-enforced on every profile.
        </span>
      </div>

      {error ? <div className="rounded-panel bg-status-danger-bg px-3 py-2 text-sm text-status-danger-fg">{error}</div> : null}

      <div className="flex justify-end gap-2.5">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={pending || !form.name}>
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

function BrandProfileDetail({
  profile,
  canEdit,
  onBack,
  onEdit,
  onDelete,
}: {
  profile: BrandProfile;
  canEdit: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const phrases = profile.forbidden_phrases
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3.5">
        <div>
          <button onClick={onBack} className="mb-2 text-xs text-text-muted hover:text-text-primary">
            &larr; Brand Voice
          </button>
          <div className="text-lg font-semibold text-text-primary">{profile.name}</div>
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
        <DetailRow label="Tone" value={profile.tone} />
        <DetailRow label="Reading level" value={profile.reading_level} />
      </div>

      <div className="border-t border-border pt-4">
        <div className="mb-1.5 text-xs text-text-muted">Forbidden phrases</div>
        {phrases.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {phrases.map((phrase) => (
              <span
                key={phrase}
                className="rounded-pill border border-border bg-secondary px-2.5 py-1 text-xs text-text-secondary"
              >
                {phrase}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-sm text-text-muted">None specified</div>
        )}
      </div>

      <div className="inline-flex w-fit items-center gap-1.5 border-t border-border pt-4 text-[11px] text-status-success-fg">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
        No em dash enforced
      </div>
    </Card>
  );
}

export function BrandVoiceClient({
  profiles,
  canEdit,
}: {
  profiles: BrandProfile[];
  canEdit: boolean;
}) {
  const [view, setView] = useState<View>({ type: "list" });

  function findProfile(id: string) {
    return profiles.find((p) => p.id === id);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this brand voice profile? This can't be undone.")) return;
    await deleteBrandProfile(id);
    setView({ type: "list" });
  }

  const notFound = (
    <div className="p-10">
      <Card className="flex flex-col items-start gap-3">
        <div className="text-sm text-text-secondary">This profile no longer exists.</div>
        <Button variant="outline" onClick={() => setView({ type: "list" })}>
          Back to Brand Voice
        </Button>
      </Card>
    </div>
  );

  if (view.type === "detail") {
    const profile = findProfile(view.id);
    if (!profile) return notFound;
    return (
      <div className="p-10">
        <BrandProfileDetail
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
          &larr; {profile.name}
        </button>
        <BrandProfileForm
          initial={profile}
          onCancel={() => setView({ type: "detail", id: profile.id })}
          onSubmit={async (input) => {
            await updateBrandProfile(profile.id, input);
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
          <h1 className="text-2xl font-semibold text-text-primary">Brand Voice</h1>
          <p className="text-sm text-text-muted">Reusable tone and style rules.</p>
        </div>
        {canEdit ? (
          <Button onClick={() => setView({ type: "create" })}>+ New Brand Voice</Button>
        ) : null}
      </div>

      {view.type === "create" ? (
        <div className="mb-5">
          <BrandProfileForm
            initial={EMPTY_FORM}
            onCancel={() => setView({ type: "list" })}
            onSubmit={async (input) => {
              await createBrandProfile(input);
              setView({ type: "list" });
            }}
          />
        </div>
      ) : null}

      {profiles.length === 0 && view.type !== "create" ? (
        <div className="py-16 text-center text-sm text-text-muted">No brand voice profiles yet.</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.map((p) => (
          <button key={p.id} onClick={() => setView({ type: "detail", id: p.id })} className="text-left">
            <Card className="flex h-full flex-col gap-2 transition-colors hover:border-primary">
              <div className="text-[14.5px] font-semibold text-text-primary">{p.name}</div>
              <div className="text-[12.5px] text-text-secondary">{p.tone}</div>
              <div className="text-[11.5px] text-text-muted">Reading level: {p.reading_level}</div>
              <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-status-success-fg">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                No em dash enforced
              </div>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
