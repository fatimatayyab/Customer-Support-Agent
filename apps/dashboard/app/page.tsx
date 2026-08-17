"use client";

import type { SessionUser } from "@csa/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  allowedOrigins: string[] | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function embedSnippet(apiKey: string): string {
  // No production widget-hosting URL exists yet in this project - the
  // placeholder below is deliberate, not a guess at a real one. Whoever
  // deploys apps/widget's built bundle (dist/widget.js) somewhere real
  // replaces this one line; everything else in the snippet is already
  // correct as written.
  return `<script>
  window.CSAWidgetConfig = {
    apiKey: "${apiKey}",
    apiUrl: "${API_URL}"
  };
</script>
<script src="https://YOUR-WIDGET-HOST/widget.js" async></script>`;
}

export default function DashboardHome() {
  const router = useRouter();
  const [session, setSession] = useState<{ user: SessionUser; workspace: Workspace } | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyDomains, setNewKeyDomains] = useState("");
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
    const allowedOrigins = newKeyDomains
      .split(",")
      .map((domain) => domain.trim())
      .filter((domain) => domain.length > 0);
    const result = await apiFetch<{ apiKey: ApiKeySummary & { rawKey: string } }>("/workspaces/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: newKeyName, ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}) }),
    });
    if (result) {
      setRevealedKey(result.apiKey.rawKey);
      setApiKeys((keys) => [...keys, result.apiKey]);
      setNewKeyName("");
      setNewKeyDomains("");
    }
  }

  async function handleRevoke(id: string) {
    await apiFetch(`/workspaces/api-keys/${id}`, { method: "DELETE" });
    setApiKeys((keys) => keys.filter((key) => key.id !== id));
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
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
          <Link href="/conversations" className="text-sm text-slate-500 underline">
            Conversations
          </Link>
          <Link href="/knowledge" className="text-sm text-slate-500 underline">
            Knowledge
          </Link>
          <Link href="/analytics" className="text-sm text-slate-500 underline">
            Analytics
          </Link>
          <Link href="/integrations" className="text-sm text-slate-500 underline">
            Integrations
          </Link>
          <Link href="/team" className="text-sm text-slate-500 underline">
            Team
          </Link>
          <button onClick={handleLogout} className="text-sm text-slate-500 underline">
            Log out
          </button>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Widget Keys</h2>

        {revealedKey && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="mb-1 font-medium text-amber-800">
              Copy this now - you won&apos;t see it again after this. It&apos;s fine for this to live in your site&apos;s
              public source (that&apos;s how it gets used); it identifies your widget, it isn&apos;t a password.
            </p>
            <div className="mb-3 flex items-center gap-2">
              <code className="flex-1 break-all">{revealedKey}</code>
              <button
                onClick={() => copyToClipboard(revealedKey)}
                className="shrink-0 rounded-md border border-amber-300 px-2 py-1 text-xs"
              >
                Copy
              </button>
            </div>
            <p className="mb-1 text-xs font-medium text-amber-800 uppercase tracking-wide">Embed on your site</p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 overflow-x-auto rounded bg-white p-2 text-xs">{embedSnippet(revealedKey)}</pre>
              <button
                onClick={() => copyToClipboard(embedSnippet(revealedKey))}
                className="shrink-0 rounded-md border border-amber-300 px-2 py-1 text-xs"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        <ul className="mb-4 divide-y divide-slate-200 rounded-md border border-slate-200">
          {apiKeys.length === 0 && <li className="p-3 text-sm text-slate-500">No widget keys yet.</li>}
          {apiKeys.map((key) => (
            <li key={key.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <div>
                  {key.name} <code className="text-slate-500">{key.keyPrefix}...</code>
                </div>
                <div className="text-slate-500">
                  {key.allowedOrigins && key.allowedOrigins.length > 0
                    ? `restricted to ${key.allowedOrigins.join(", ")}`
                    : "not restricted to any domain"}
                </div>
              </div>
              <button onClick={() => handleRevoke(key.id)} className="text-red-600 underline">
                Revoke
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleCreateKey} className="flex flex-col gap-2">
          <div className="flex gap-2">
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
          </div>
          <input
            value={newKeyDomains}
            onChange={(event) => setNewKeyDomains(event.target.value)}
            placeholder="Allowed domains, comma-separated (optional - e.g. example.com, blog.example.com)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </form>
      </section>
    </main>
  );
}
