"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../../../lib/api";

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

  async function handleToggleStatus() {
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

  async function handleRevokeKey(keyId: string) {
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
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/platform" className="mt-4 inline-block text-sm text-slate-500 underline">
          Back
        </Link>
      </main>
    );
  }

  if (!detail) {
    return null;
  }

  const { workspace, users, auditLog, usage, apiKeys } = detail;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{workspace.name}</h1>
          <p className="text-sm text-slate-500">
            {workspace.slug} · created {new Date(workspace.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Link href="/platform" className="text-sm text-slate-500 underline">
          Back
        </Link>
      </div>

      <section className="mb-10 flex items-center justify-between rounded-md border border-slate-200 p-4">
        <span
          className={
            workspace.status === "active"
              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
              : "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
          }
        >
          {workspace.status}
        </span>
        <button
          onClick={handleToggleStatus}
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {workspace.status === "active" ? "Suspend workspace" : "Reactivate workspace"}
        </button>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Overview</h2>

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

        <form onSubmit={handleSaveMeta} className="rounded-md border border-slate-200 p-4">
          <div className="mb-3 flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Plan</span>
            <input
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
              placeholder="e.g. trial, standard, custom"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
          <div className="mb-3 flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Billing notes</span>
            <textarea
              value={billingNotes}
              onChange={(event) => setBillingNotes(event.target.value)}
              placeholder="Internal notes only - never shown to this client."
              rows={3}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
          {metaError && <p className="mb-2 text-sm text-red-600">{metaError}</p>}
          <button
            type="submit"
            disabled={savingMeta}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {savingMeta ? "Saving..." : "Save"}
          </button>
        </form>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Widget &amp; keys</h2>
        {keyActionError && <p className="mb-2 text-sm text-red-600">{keyActionError}</p>}
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {apiKeys.length === 0 && <li className="p-3 text-sm text-slate-500">No API keys.</li>}
          {apiKeys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-4 p-3 text-sm">
              <div>
                <div className="font-medium">
                  {key.name} <code className="text-slate-500">{key.keyPrefix}...</code>
                </div>
                <div className="text-slate-500">
                  {key.revokedAt ? "revoked" : key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleString()}` : "never used"}
                </div>
              </div>
              {!key.revokedAt && (
                <button
                  onClick={() => handleRevokeKey(key.id)}
                  disabled={keyActionBusy === key.id}
                  className="shrink-0 text-red-600 underline disabled:opacity-50"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Team</h2>
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {users.length === 0 && <li className="p-3 text-sm text-slate-500">No users.</li>}
          {users.map((user) => (
            <li key={user.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <div className="font-medium">{user.name}</div>
                <div className="text-slate-500">{user.email}</div>
              </div>
              <span className="text-slate-500">{user.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Audit log</h2>
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {auditLog.length === 0 && <li className="p-3 text-sm text-slate-500">No platform actions recorded yet.</li>}
          {auditLog.map((entry) => (
            <li key={entry.id} className="p-3 text-sm">
              <div className="font-medium">{entry.action}</div>
              <div className="text-slate-500">
                {entry.platformAdminEmail} · {new Date(entry.createdAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-slate-500 capitalize">{label}</div>
    </div>
  );
}
