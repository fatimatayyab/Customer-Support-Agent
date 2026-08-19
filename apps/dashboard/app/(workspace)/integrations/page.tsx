"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InlineError } from "@/components/ui/error-state";
import { Input } from "@/components/ui/field";
import { apiFetch, ApiError } from "@/lib/api";

interface Integration {
  id: string;
  provider: string;
  status: "connected" | "error" | "disconnected";
  lastVerifiedAt: string | null;
  createdAt: string;
}

const STATUS_TONES: Record<Integration["status"], BadgeTone> = {
  connected: "success",
  error: "danger",
  disconnected: "neutral",
};

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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-slate-900">Integrations</h1>

      <Card>
        <CardHeader title="HubSpot" />
        <CardBody>
          {hubspot ? (
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONES[hubspot.status]}>{hubspot.status}</Badge>
                {hubspot.lastVerifiedAt && (
                  <span className="text-slate-500">verified {new Date(hubspot.lastVerifiedAt).toLocaleString()}</span>
                )}
              </div>
              <button onClick={() => handleDisconnect(hubspot.id)} className="text-sm text-red-600 hover:underline">
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
              <Input
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                placeholder="pat-na1-..."
                required
                type="password"
              />
              {error && <InlineError message={error} />}
              <Button type="submit" disabled={connecting} className="self-start">
                {connecting ? "Connecting..." : "Connect HubSpot"}
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
