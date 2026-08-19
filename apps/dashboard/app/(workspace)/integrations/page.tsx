"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";

interface Integration {
  id: string;
  provider: string;
  status: "connected" | "error" | "disconnected";
  lastVerifiedAt: string | null;
  createdAt: string;
}

export default function IntegrationsPage() {
  const router = useRouter();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const data = await apiFetch<{ integrations: Integration[] }>("/integrations");
    setIntegrations(data?.integrations ?? []);
  }

  useEffect(() => {
    refresh().catch(() => router.push("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect(event: FormEvent) {
    event.preventDefault();
    setConnecting(true);
    setError(null);
    try {
      await apiFetch("/integrations/hubspot/connect", {
        method: "POST",
        body: JSON.stringify({ accessToken }),
      });
      setAccessToken("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not connect HubSpot.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect(id: string) {
    await apiFetch(`/integrations/${id}`, { method: "DELETE" });
    await refresh();
  }

  if (!integrations) {
    return null;
  }

  const hubspot = integrations.find((integration) => integration.provider === "hubspot");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <Link href="/" className="text-sm text-slate-500 underline">
          Back
        </Link>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">HubSpot</h2>

        {hubspot ? (
          <div className="mb-4 flex items-center justify-between rounded-md border border-slate-200 p-3 text-sm">
            <div>
              <StatusBadge status={hubspot.status} />
              {hubspot.lastVerifiedAt && (
                <span className="ml-2 text-slate-500">
                  verified {new Date(hubspot.lastVerifiedAt).toLocaleString()}
                </span>
              )}
            </div>
            <button onClick={() => handleDisconnect(hubspot.id)} className="text-red-600 underline">
              Disconnect
            </button>
          </div>
        ) : (
          <form onSubmit={handleConnect} className="flex flex-col gap-2">
            <label className="text-sm text-slate-600">
              Private App access token
              <a
                href="https://developers.hubspot.com/docs/api/private-apps"
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-xs text-slate-400 underline"
              >
                how to create one
              </a>
            </label>
            <input
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder="pat-na1-..."
              required
              type="password"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={connecting}
              className="self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? "Connecting..." : "Connect HubSpot"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: Integration["status"] }) {
  const colors: Record<Integration["status"], string> = {
    connected: "text-green-600",
    error: "text-red-600",
    disconnected: "text-slate-400",
  };
  return <span className={colors[status]}>{status}</span>;
}
