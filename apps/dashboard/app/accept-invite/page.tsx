"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/error-state";
import { Field, Input } from "@/components/ui/field";
import { PageSkeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";

interface InvitationPreview {
  workspaceName: string;
  email: string;
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  administrator: "Administrator",
  support_agent: "Support Agent",
};

function AcceptInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPreviewError("This invitation link is missing a token.");
      return;
    }
    apiFetch<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`)
      .then((data) => setPreview(data))
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : "This invitation link is invalid."));
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetch(`/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        body: JSON.stringify({ name, password }),
      });
      router.push("/");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not accept the invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  if (previewError) {
    return (
      <main className="mx-auto max-w-sm px-4 py-20 text-center">
        <InlineError message={previewError} />
      </main>
    );
  }

  if (!preview) {
    return <PageSkeleton />;
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-20">
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Join {preview.workspaceName}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {preview.email} · {ROLE_LABELS[preview.role] ?? preview.role}
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Your name">
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Password">
          <Input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            minLength={8}
          />
        </Field>
        {submitError && <InlineError message={submitError} />}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Joining..." : "Accept invitation"}
        </Button>
      </form>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
