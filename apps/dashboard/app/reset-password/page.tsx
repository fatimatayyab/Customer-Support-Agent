"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/error-state";
import { Field, Input } from "@/components/ui/field";
import { PageSkeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";

  const [previewError, setPreviewError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reset, setReset] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreviewError("This reset link is missing a token.");
      return;
    }
    apiFetch<{ email: string }>(`/reset-password?token=${encodeURIComponent(token)}`)
      .then(() => setPreviewError(null))
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : "This reset link is invalid."));
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    if (password !== confirmPassword) {
      setSubmitError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      setReset(true);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not reset your password.");
    } finally {
      setSubmitting(false);
    }
  }

  if (previewError) {
    return (
      <main className="mx-auto max-w-sm px-4 py-20 text-center">
        <InlineError message={previewError} />
        <p className="mt-4 text-sm text-slate-500">
          <Link href="/forgot-password" className="text-slate-900 underline">
            Request a new link
          </Link>
        </p>
      </main>
    );
  }

  if (reset) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <h1 className="mb-3 text-xl font-semibold text-slate-900">Password reset</h1>
        <p className="text-sm text-slate-600">Your password has been updated. You can now log in with it.</p>
        <p className="mt-6 text-sm text-slate-500">
          <Link href="/login" className="text-slate-900 underline">
            Go to login
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Choose a new password</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="New password">
          <Input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        {submitError && <InlineError message={submitError} />}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Resetting..." : "Reset password"}
        </Button>
      </form>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}