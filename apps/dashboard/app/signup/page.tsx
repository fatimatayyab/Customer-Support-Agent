"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";

// Zod's issue.path is a mixed (string | number)[] - path[0] is the field
// name for every field-level error this form can actually produce.
function formatSignupError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.issues?.length) {
      return err.issues.map((issue) => `${String(issue.path[0] ?? "Field")}: ${issue.message}`).join(" ");
    }
    return err.message;
  }
  return "Something went wrong.";
}

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Workspace creation is invite-gated - see docs/07's "Invite-Only
  // Workspace Signup" entry. The link a teammate is sent (pnpm --filter
  // @csa/db invite) already carries both token and email as query params,
  // so this is a straight prefill, not something typed in by hand.
  const inviteToken = searchParams.get("token") ?? "";

  const [workspaceName, setWorkspaceName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ workspaceName, name, email, password, inviteToken }),
      });
      router.push("/");
    } catch (err) {
      setError(formatSignupError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-xl font-semibold">Create your workspace</h1>
      <p className="mb-6 text-sm text-slate-500">You'll be signed in as the workspace owner.</p>

      {!inviteToken ? (
        <p className="text-sm text-red-600">
          This signup link is missing its invite token. You'll need a valid invite link to create a workspace - reach
          out if you don't have one.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label="Business / workspace name"
            value={workspaceName}
            onChange={setWorkspaceName}
            placeholder="Acme Support"
          />
          <Field label="Your name" value={name} onChange={setName} placeholder="Jane Doe" />
          <Field label="Email" type="email" value={email} onChange={setEmail} />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            minLength={8}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create workspace"}
          </button>
        </form>
      )}

      <p className="mt-4 text-sm text-slate-500">
        Already have a workspace?{" "}
        <Link href="/login" className="text-slate-900 underline">
          Log in
        </Link>
      </p>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  minLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        required
        minLength={minLength}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
      />
    </label>
  );
}

// useSearchParams() requires a Suspense boundary - matches the existing
// accept-invite page's exact same shape for the exact same reason.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
