"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/error-state";
import { Input } from "@/components/ui/field";
import { PageSkeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";

interface Integration {
  id: string;
  provider: string;
  status: "connected" | "error" | "disconnected";
  lastVerifiedAt: string | null;
  createdAt: string;
  aiToolCallingEnabled: boolean;
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
  const [disconnectTarget, setDisconnectTarget] = useState<Integration | null>(null);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [toolCallingBusy, setToolCallingBusy] = useState(false);

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

  async function performDisconnect(id: string) {
    setDisconnectBusy(true);
    try {
      await apiFetch(`/integrations/${id}`, { method: "DELETE" });
      await refresh();
    } finally {
      setDisconnectBusy(false);
      setDisconnectTarget(null);
    }
  }

  async function handleToggleAiToolCalling(id: string, enabled: boolean) {
    setToolCallingBusy(true);
    setError(null);
    try {
      await apiFetch(`/integrations/${id}/ai-tool-calling`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this setting.");
    } finally {
      setToolCallingBusy(false);
    }
  }

  if (!integrations) {
    return <PageSkeleton />;
  }

  const hubspot = integrations.find((integration) => integration.provider === "hubspot");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-slate-900">Integrations</h1>

      <Card>
        <CardHeader title="HubSpot" />
        <CardBody>
          {hubspot ? (
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONES[hubspot.status]}>{hubspot.status}</Badge>
                  {hubspot.lastVerifiedAt && (
                    <span className="text-slate-500">verified {new Date(hubspot.lastVerifiedAt).toLocaleString()}</span>
                  )}
                </div>
                <button onClick={() => setDisconnectTarget(hubspot)} className="text-sm text-red-600 hover:underline">
                  Disconnect
                </button>
              </div>

              <label className="flex items-start gap-3 rounded-md border border-slate-200 p-3">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={hubspot.aiToolCallingEnabled}
                  disabled={toolCallingBusy}
                  onChange={(event) => handleToggleAiToolCalling(hubspot.id, event.target.checked)}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium text-slate-900">Let the AI look up a customer&apos;s contact record</span>
                  <span className="text-slate-500">
                    When a customer asks about their own account identity or status and shares their email, the AI may
                    look it up in HubSpot before replying. Off by default.
                  </span>
                </span>
              </label>

              {error && <InlineError message={error} />}
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

      <ConfirmDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        title="Disconnect HubSpot?"
        description="Contact lookups from conversations will stop working until you reconnect with a new access token."
        confirmLabel="Disconnect"
        busy={disconnectBusy}
        onConfirm={() => disconnectTarget && performDisconnect(disconnectTarget.id)}
      />
    </div>
  );
}
