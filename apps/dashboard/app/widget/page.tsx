"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const DEFAULT_INSTALL_NAME = "Website";

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

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function WidgetPage() {
  const router = useRouter();
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[] | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteDomains, setNewSiteDomains] = useState("");
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [advancedBusy, setAdvancedBusy] = useState<string | null>(null);

  async function refresh(): Promise<ApiKeySummary[]> {
    const data = await apiFetch<{ apiKeys: ApiKeySummary[] }>("/workspaces/api-keys");
    const keys = data?.apiKeys ?? [];
    setApiKeys(keys);
    return keys;
  }

  useEffect(() => {
    refresh()
      .then(async (keys) => {
        // First visit: nothing installed yet, so there's nothing to
        // decide - silently provision the default install rather than
        // asking the owner to understand "create a key" before they can
        // even see what an install looks like.
        if (keys.length === 0) {
          setInstallBusy(true);
          try {
            const result = await apiFetch<{ apiKey: ApiKeySummary & { rawKey: string } }>("/workspaces/api-keys", {
              method: "POST",
              body: JSON.stringify({ name: DEFAULT_INSTALL_NAME }),
            });
            if (result) {
              setRevealedKey(result.apiKey.rawKey);
              setApiKeys([result.apiKey]);
            }
          } catch (err) {
            setInstallError(err instanceof ApiError ? err.message : "Could not set up your install code.");
          } finally {
            setInstallBusy(false);
          }
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }

  async function handleGetNewCode(id: string) {
    setInstallBusy(true);
    setInstallError(null);
    try {
      const result = await apiFetch<{ apiKey: ApiKeySummary & { rawKey: string } }>(
        `/workspaces/api-keys/${id}/rotate`,
        { method: "POST" },
      );
      if (result) {
        setRevealedKey(result.apiKey.rawKey);
        setApiKeys((keys) => (keys ? keys.map((key) => (key.id === id ? result.apiKey : key)) : [result.apiKey]));
      }
    } catch (err) {
      setInstallError(err instanceof ApiError ? err.message : "Could not get a new install code.");
    } finally {
      setInstallBusy(false);
    }
  }

  async function handleAddSite(event: FormEvent) {
    event.preventDefault();
    setAdvancedError(null);
    const allowedOrigins = newSiteDomains
      .split(",")
      .map((domain) => domain.trim())
      .filter((domain) => domain.length > 0);
    try {
      const result = await apiFetch<{ apiKey: ApiKeySummary & { rawKey: string } }>("/workspaces/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newSiteName, ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}) }),
      });
      if (result) {
        setRevealedKey(result.apiKey.rawKey);
        setApiKeys((keys) => (keys ? [...keys, result.apiKey] : [result.apiKey]));
        setNewSiteName("");
        setNewSiteDomains("");
      }
    } catch (err) {
      setAdvancedError(err instanceof ApiError ? err.message : "Could not add this site.");
    }
  }

  async function handleRevoke(id: string) {
    setAdvancedBusy(id);
    setAdvancedError(null);
    try {
      await apiFetch(`/workspaces/api-keys/${id}`, { method: "DELETE" });
      setApiKeys((keys) => (keys ? keys.filter((key) => key.id !== id) : keys));
    } catch (err) {
      setAdvancedError(err instanceof ApiError ? err.message : "Could not remove this site.");
    } finally {
      setAdvancedBusy(null);
    }
  }

  if (apiKeys === null) {
    return null;
  }

  // The primary/default install. Prefer matching by name over "oldest
  // createdAt": rotating a key creates a new row with a fresh createdAt,
  // which would otherwise silently hand "primary" status to a different
  // site the next time this key is rotated. The auto-provisioned default
  // always keeps its name across rotation (the backend copies it), so
  // name is the stable identity here, not creation order.
  const byOldest = [...apiKeys].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const primary = apiKeys.find((key) => key.name === DEFAULT_INSTALL_NAME) ?? byOldest[0];

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Chat Widget</h1>
        <Link href="/" className="text-sm text-slate-500 underline">
          Back
        </Link>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Install</h2>

        {installError && <p className="mb-3 text-sm text-red-600">{installError}</p>}

        {installBusy && !revealedKey && <p className="text-sm text-slate-500">Setting up your install code...</p>}

        {revealedKey && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="mb-1 font-medium text-amber-800">
              Add this to your site to turn your assistant on. This code identifies your widget - it&apos;s fine for
              it to live in your site&apos;s public source, it isn&apos;t a password.
            </p>
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

        {primary && !installBusy && (
          <div className="flex items-center justify-between rounded-md border border-slate-200 p-3 text-sm">
            <div>
              <div className="font-medium text-emerald-700">✓ Installed</div>
              <div className="text-slate-500">Last customer interaction: {formatRelativeTime(primary.lastUsedAt)}</div>
            </div>
            {!revealedKey && (
              <button
                onClick={() => handleGetNewCode(primary.id)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium"
              >
                Get a new install code
              </button>
            )}
          </div>
        )}
      </section>

      <details className="rounded-md border border-slate-200">
        <summary className="cursor-pointer p-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Advanced
        </summary>
        <div className="border-t border-slate-200 p-3">
          {advancedError && <p className="mb-3 text-sm text-red-600">{advancedError}</p>}

          <ul className="mb-4 divide-y divide-slate-200 rounded-md border border-slate-200">
            {apiKeys.length === 0 && <li className="p-3 text-sm text-slate-500">No sites yet.</li>}
            {apiKeys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-4 p-3 text-sm">
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
                <div className="flex shrink-0 gap-3">
                  <button
                    onClick={() => handleGetNewCode(key.id)}
                    disabled={advancedBusy === key.id}
                    className="text-slate-600 underline disabled:opacity-50"
                  >
                    Rotate
                  </button>
                  <button
                    onClick={() => handleRevoke(key.id)}
                    disabled={advancedBusy === key.id}
                    className="text-red-600 underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <form onSubmit={handleAddSite} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={newSiteName}
                onChange={(event) => setNewSiteName(event.target.value)}
                placeholder="Site name (e.g. Blog)"
                required
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                Add another site
              </button>
            </div>
            <input
              value={newSiteDomains}
              onChange={(event) => setNewSiteDomains(event.target.value)}
              placeholder="Restrict to domains, comma-separated (optional)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </form>
        </div>
      </details>
    </main>
  );
}
