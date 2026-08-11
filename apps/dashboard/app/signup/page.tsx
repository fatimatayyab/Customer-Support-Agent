"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ workspaceName, name, email, password }),
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
      <h1 className="mb-1 text-xl font-semibold">Create your workspace</h1>
      <p className="mb-6 text-sm text-slate-500">You'll be signed in as the workspace owner.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label="Business / workspace name"
          value={workspaceName}
          onChange={setWorkspaceName}
          placeholder="Acme Support"
        />
        <Field label="Your name" value={name} onChange={setName} placeholder="Jane Doe" />
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Creating..." : "Create workspace"}
        </button>
      </form>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
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
        className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
      />
    </label>
  );
}
