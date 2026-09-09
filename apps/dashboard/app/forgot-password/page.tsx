"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/error-state";
import { Field, Input } from "@/components/ui/field";
import { ApiError, apiFetch } from "@/lib/api";

// Deliberately shows the same neutral success message regardless of
// whether the account exists - mirrors the API's no-enumeration behavior.
export default function ForgotPasswordPage() {
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ workspaceSlug, email }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <h1 className="mb-3 text-xl font-semibold text-slate-900">Check your email</h1>
        <p className="text-sm text-slate-600">
          If an account exists for <span className="font-medium text-slate-900">{email}</span>, we&apos;ve sent a
          single-use link to reset your password.
        </p>
        <p className="mt-6 text-sm text-slate-500">
          <Link href="/login" className="text-slate-900 underline">
            Back to login
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Reset your password</h1>
      <p className="mb-6 text-sm text-slate-500">
        Enter your workspace and email and we&apos;ll send you a reset link if an account exists.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Workspace">
          <Input
            value={workspaceSlug}
            onChange={(event) => setWorkspaceSlug(event.target.value)}
            placeholder="acme-support"
            required
          />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        {error && <InlineError message={error} />}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Sending..." : "Send reset link"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-slate-500">
        <Link href="/login" className="text-slate-900 underline">
          Back to login
        </Link>
      </p>
    </main>
  );
}