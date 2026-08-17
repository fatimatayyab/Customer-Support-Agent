"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

interface WorkspaceDetail {
  workspace: Workspace;
  users: WorkspaceUser[];
  auditLog: AuditLogEntry[];
}

export default function PlatformWorkspaceDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const data = await apiFetch<WorkspaceDetail>(`/platform/workspaces/${params.id}`);
    setDetail(data);
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

  const { workspace, users, auditLog } = detail;

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
