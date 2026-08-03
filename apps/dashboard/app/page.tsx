"use client";

import type { SessionUser } from "@csa/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function DashboardHome() {
  const router = useRouter();
  const [session, setSession] = useState<{ user: SessionUser; workspace: Workspace } | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ user: SessionUser; workspace: Workspace }>("/auth/me")
      .then((data) => {
        setSession(data);
        return apiFetch<{ apiKeys: ApiKeySummary[] }>("/workspaces/api-keys");
      })
      .then((data) => data && setApiKeys(data.apiKeys))
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleLogout() {
    await apiFetch("/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function handleCreateKey(event: FormEvent) {
    event.preventDefault();
    const result = await apiFetch<{ apiKey: ApiKeySummary & { rawKey: string } }>("/workspaces/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: newKeyName }),
    });
    if (result) {
      setRevealedKey(result.apiKey.rawKey);
      setApiKeys((keys) => [...keys, result.apiKey]);
      setNewKeyName("");
    }
  }

  async function handleRevoke(id: string) {
    await apiFetch(`/workspaces/api-keys/${id}`, { method: "DELETE" });
    setApiKeys((keys) => keys.filter((key) => key.id !== id));
  }

  if (loading || !session) {
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{session.workspace.name}</h1>
          <p className="text-sm text-slate-500">
            {session.user.email} · {session.user.role}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/knowledge" className="text-sm text-slate-500 underline">
            Knowledge
          </Link>
          <button onClick={handleLogout} className="text-sm text-slate-500 underline">
            Log out
          </button>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">API Keys</h2>

        {revealedKey && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="mb-1 font-medium text-amber-800">Copy this now - it won&apos;t be shown again:</p>
            <code className="break-all">{revealedKey}</code>
          </div>
        )}

        <ul className="mb-4 divide-y divide-slate-200 rounded-md border border-slate-200">
          {apiKeys.length === 0 && <li className="p-3 text-sm text-slate-500">No API keys yet.</li>}
          {apiKeys.map((key) => (
            <li key={key.id} className="flex items-center justify-between p-3 text-sm">
              <span>
                {key.name} <code className="text-slate-500">{key.keyPrefix}...</code>
              </span>
              <button onClick={() => handleRevoke(key.id)} className="text-red-600 underline">
                Revoke
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleCreateKey} className="flex gap-2">
          <input
            value={newKeyName}
            onChange={(event) => setNewKeyName(event.target.value)}
            placeholder="Key name (e.g. Website widget)"
            required
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Create
          </button>
        </form>
      </section>
    </main>
  );
}
