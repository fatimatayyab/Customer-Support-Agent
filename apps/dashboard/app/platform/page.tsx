"use client";

import type { PlatformAdminSession } from "@csa/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  createdAt: string;
  ownerEmail: string | null;
  userCount: number;
}

interface WorkspaceInvite {
  id: string;
  email: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export default function PlatformHome() {
  const router = useRouter();
  const [admin, setAdmin] = useState<PlatformAdminSession | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [invites, setInvites] = useState<WorkspaceInvite[] | null>(null);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [revealedInviteUrl, setRevealedInviteUrl] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh() {
    const [workspacesData, invitesData] = await Promise.all([
      apiFetch<{ workspaces: WorkspaceRow[] }>("/platform/workspaces"),
      apiFetch<{ invites: WorkspaceInvite[] }>("/platform/workspace-invites"),
    ]);
    setWorkspaces(workspacesData?.workspaces ?? []);
    setInvites(invitesData?.invites ?? []);
  }

  useEffect(() => {
    apiFetch<{ platformAdmin: PlatformAdminSession }>("/platform/me")
      .then((data) => setAdmin(data?.platformAdmin ?? null))
      .catch(() => router.push("/platform/login"));
    refresh().catch(() => router.push("/platform/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await apiFetch("/platform/logout", { method: "POST" });
    router.push("/platform/login");
  }

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    setInviteError(null);
    setRevealedInviteUrl(null);
    try {
      const result = await apiFetch<{ inviteUrl: string }>("/platform/workspace-invites", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      if (result) {
        setRevealedInviteUrl(result.inviteUrl);
        setEmail("");
        await refresh();
      }
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Could not create the signup link.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevokeInvite(id: string) {
    setActionBusy(id);
    setActionError(null);
    try {
      await apiFetch(`/platform/workspace-invites/${id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not revoke the invite.");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleToggleStatus(workspace: WorkspaceRow) {
    setActionBusy(workspace.id);
    setActionError(null);
    const action = workspace.status === "active" ? "suspend" : "reactivate";
    try {
      await apiFetch(`/platform/workspaces/${workspace.id}/${action}`, { method: "POST" });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : `Could not ${action} the workspace.`);
    } finally {
      setActionBusy(null);
    }
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }

  if (!workspaces || !invites || !admin) {
    return null;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Platform Owner</h1>
          <p className="text-sm text-slate-500">{admin.email}</p>
        </div>
        <button onClick={handleLogout} className="text-sm text-slate-500 underline">
          Log out
        </button>
      </div>

      {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Workspaces</h2>
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {workspaces.length === 0 && <li className="p-3 text-sm text-slate-500">No workspaces yet.</li>}
          {workspaces.map((workspace) => (
            <li key={workspace.id} className="flex items-center justify-between gap-4 p-3 text-sm">
              <div>
                <Link href={`/platform/workspaces/${workspace.id}`} className="font-medium underline">
                  {workspace.name}
                </Link>
                <div className="text-slate-500">
                  {workspace.slug} · {workspace.ownerEmail ?? "no owner"} · {workspace.userCount} user
                  {workspace.userCount === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
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
                  onClick={() => handleToggleStatus(workspace)}
                  disabled={actionBusy === workspace.id}
                  className="text-slate-600 underline disabled:opacity-50"
                >
                  {workspace.status === "active" ? "Suspend" : "Reactivate"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Provision a new client</h2>

        {revealedInviteUrl && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="mb-1 font-medium text-amber-800">
              Share this link with them - there&apos;s no automatic email yet, so this is the only way they&apos;ll get it.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all">{revealedInviteUrl}</code>
              <button
                onClick={() => copyToClipboard(revealedInviteUrl)}
                className="shrink-0 rounded-md border border-amber-300 px-2 py-1 text-xs"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleInvite} className="mb-6 flex gap-2">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="new-client@company.com"
            type="email"
            required
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={inviting}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {inviting ? "Creating..." : "Create signup link"}
          </button>
        </form>
        {inviteError && <p className="mb-4 text-sm text-red-600">{inviteError}</p>}

        <h3 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Signup links</h3>
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {invites.length === 0 && <li className="p-3 text-sm text-slate-500">No signup links yet.</li>}
          {invites.map((invite) => {
            const expired = new Date(invite.expiresAt).getTime() <= Date.now();
            const state = invite.usedAt ? "used" : expired ? "expired" : "pending";
            return (
              <li key={invite.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                <div>
                  <div className="font-medium">{invite.email}</div>
                  <div className="text-slate-500">
                    {state} · created {new Date(invite.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {state === "pending" && (
                  <button
                    onClick={() => handleRevokeInvite(invite.id)}
                    disabled={actionBusy === invite.id}
                    className="shrink-0 text-red-600 underline disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
