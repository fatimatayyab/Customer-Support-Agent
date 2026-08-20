"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/error-state";
import { Input, Textarea } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageSkeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  role: "owner" | "administrator" | "support_agent";
  status: string;
  createdAt: string;
}

interface AuditLogEntry {
  id: string;
  action: string;
  detail: unknown;
  createdAt: string;
  platformAdminEmail: string;
}

interface StatusCount {
  status: string;
  count: number;
}

interface IntegrationSummary {
  provider: string;
  status: string;
}

interface Usage {
  totalConversations: number;
  statusBreakdown: StatusCount[];
  knowledgeSourceCount: number;
  integrations: IntegrationSummary[];
}

interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface PlatformMeta {
  plan: string | null;
  billingNotes: string | null;
  updatedAt: string | null;
}

interface WorkspaceDetail {
  workspace: Workspace;
  users: WorkspaceUser[];
  auditLog: AuditLogEntry[];
  usage: Usage;
  apiKeys: ApiKeySummary[];
  meta: PlatformMeta;
}

export default function PlatformWorkspaceDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState("");
  const [billingNotes, setBillingNotes] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [keyActionBusy, setKeyActionBusy] = useState<string | null>(null);
  const [keyActionError, setKeyActionError] = useState<string | null>(null);
  const [suspendConfirmOpen, setSuspendConfirmOpen] = useState(false);
  const [revokeKeyTarget, setRevokeKeyTarget] = useState<ApiKeySummary | null>(null);

  async function refresh() {
    const data = await apiFetch<WorkspaceDetail>(`/platform/workspaces/${params.id}`);
    setDetail(data);
    if (data) {
      setPlan(data.meta.plan ?? "");
      setBillingNotes(data.meta.billingNotes ?? "");
    }
  }

  useEffect(() => {
    refresh().catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/platform/login");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not load this workspace.");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function performToggleStatus() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    const action = detail.workspace.status === "active" ? "suspend" : "reactivate";
    try {
      await apiFetch(`/platform/workspaces/${detail.workspace.id}/${action}`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${action} the workspace.`);
    } finally {
      setBusy(false);
      setSuspendConfirmOpen(false);
    }
  }

  // Same asymmetry as the workspace list: suspend gets a confirm step
  // (it immediately cuts off live widget traffic), reactivate doesn't.
  function handleToggleStatus() {
    if (!detail) return;
    if (detail.workspace.status === "active") {
      setSuspendConfirmOpen(true);
    } else {
      void performToggleStatus();
    }
  }

  async function handleSaveMeta(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setSavingMeta(true);
    setMetaError(null);
    try {
      await apiFetch(`/platform/workspaces/${detail.workspace.id}/meta`, {
        method: "PATCH",
        body: JSON.stringify({ plan: plan.trim() || null, billingNotes: billingNotes.trim() || null }),
      });
      await refresh();
    } catch (err) {
      setMetaError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSavingMeta(false);
    }
  }

  async function performRevokeKey(keyId: string) {
    if (!detail) return;
    setKeyActionBusy(keyId);
    setKeyActionError(null);
    try {
      await apiFetch(`/platform/workspaces/${detail.workspace.id}/api-keys/${keyId}/revoke`, { method: "POST" });
      await refresh();
    } catch (err) {
      setKeyActionError(err instanceof ApiError ? err.message : "Could not revoke this key.");
    } finally {
      setKeyActionBusy(null);
      setRevokeKeyTarget(null);
    }
  }

  if (error) {
    return (
      <div>
        <InlineError message={error} />
        <Link href="/platform" className="mt-4 inline-block text-sm text-slate-500 hover:underline">
          Back
        </Link>
      </div>
    );
  }

  if (!detail) {
    return <PageSkeleton />;
  }

  const { workspace, users, auditLog, usage, apiKeys } = detail;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/platform" className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
          ← Workspaces
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{workspace.name}</h1>
            <p className="text-sm text-slate-500">
              {workspace.slug} · created {new Date(workspace.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={workspace.status === "active" ? "success" : "danger"}>{workspace.status}</Badge>
            <Button
              size="sm"
              variant={workspace.status === "active" ? "destructive" : "primary"}
              onClick={handleToggleStatus}
              disabled={busy}
            >
              {workspace.status === "active" ? "Suspend workspace" : "Reactivate workspace"}
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="keys">Widget &amp; Keys</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Conversations" value={usage.totalConversations} />
            {usage.statusBreakdown.map((row) => (
              <MiniStat key={row.status} label={row.status} value={row.count} />
            ))}
            <MiniStat label="Knowledge sources" value={usage.knowledgeSourceCount} />
          </div>

          <div className="mb-4 text-sm text-slate-500">
            Integrations:{" "}
            {usage.integrations.length === 0
              ? "none connected"
              : usage.integrations.map((i) => `${i.provider} (${i.status})`).join(", ")}
          </div>

          <Card>
            <CardBody>
              <form onSubmit={handleSaveMeta} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Plan</span>
                  <Input value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="e.g. trial, standard, custom" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Billing notes</span>
                  <Textarea
                    value={billingNotes}
                    onChange={(event) => setBillingNotes(event.target.value)}
                    placeholder="Internal notes only - never shown to this client."
                    rows={3}
                  />
                </label>
                {metaError && <InlineError message={metaError} />}
                <Button type="submit" disabled={savingMeta} className="self-start">
                  {savingMeta ? "Saving..." : "Save"}
                </Button>
              </form>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="keys" className="pt-4">
          {keyActionError && (
            <div className="mb-2">
              <InlineError message={keyActionError} />
            </div>
          )}
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {apiKeys.length === 0 && <li className="p-3 text-sm text-slate-500">No API keys.</li>}
            {apiKeys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">
                    {key.name} <code className="text-slate-500">{key.keyPrefix}...</code>
                  </div>
                  <div className="text-slate-500">
                    {key.revokedAt ? "revoked" : key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleString()}` : "never used"}
                  </div>
                </div>
                {!key.revokedAt && (
                  <button
                    onClick={() => setRevokeKeyTarget(key)}
                    disabled={keyActionBusy === key.id}
                    className="shrink-0 text-red-600 hover:underline disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="team" className="pt-4">
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {users.length === 0 && <li className="p-3 text-sm text-slate-500">No users.</li>}
            {users.map((user) => (
              <li key={user.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{user.name}</div>
                  <div className="text-slate-500">{user.email}</div>
                </div>
                <span className="text-slate-500">{user.role}</span>
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="audit" className="pt-4">
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {auditLog.length === 0 && <li className="p-3 text-sm text-slate-500">No platform actions recorded yet.</li>}
            {auditLog.map((entry) => (
              <li key={entry.id} className="p-3 text-sm">
                <div className="font-medium text-slate-900">{entry.action}</div>
                <div className="text-slate-500">
                  {entry.platformAdminEmail} · {new Date(entry.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={suspendConfirmOpen}
        onOpenChange={setSuspendConfirmOpen}
        title={`Suspend ${workspace.name}?`}
        description="This immediately stops their widget from accepting new traffic and blocks dashboard logins. You can reactivate at any time."
        confirmLabel="Suspend workspace"
        busy={busy}
        onConfirm={performToggleStatus}
      />

      <ConfirmDialog
        open={revokeKeyTarget !== null}
        onOpenChange={(open) => !open && setRevokeKeyTarget(null)}
        title={`Revoke "${revokeKeyTarget?.name}"?`}
        description="Any site using this key stops working immediately. This can't be undone - a new key would need to be issued instead."
        confirmLabel="Revoke key"
        busy={revokeKeyTarget !== null && keyActionBusy === revokeKeyTarget.id}
        onConfirm={() => revokeKeyTarget && performRevokeKey(revokeKeyTarget.id)}
      />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 capitalize">{label}</div>
    </Card>
  );
}
