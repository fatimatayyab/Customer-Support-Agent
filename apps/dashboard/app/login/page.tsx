"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/error-state";
import { Field, Input } from "@/components/ui/field";
import { ApiError, apiFetch } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ workspaceSlug, email, password }),
      });
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Log in</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Workspace">
          <Input value={workspaceSlug} onChange={(event) => setWorkspaceSlug(event.target.value)} placeholder="acme-support" required />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        {error && <InlineError message={error} />}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Logging in..." : "Log in"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-slate-500">
        New here?{" "}
        <Link href="/signup" className="text-slate-900 underline">
          Create a workspace
        </Link>
      </p>
    </main>
  );
}
