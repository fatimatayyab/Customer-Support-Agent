"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/error-state";
import { Input } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  createdAt: string;
  ownerEmail: string | null;
  userCount: number;
  plan: string | null;
  widgetConfigured: boolean;
  lastActivityAt: string | null;
}

interface WorkspaceInvite {
  id: string;
  email: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "no activity yet";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

export default function PlatformHome() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [invites, setInvites] = useState<WorkspaceInvite[] | null>(null);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [revealedInviteUrl, setRevealedInviteUrl] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<WorkspaceRow | null>(null);
  const [revokeInviteTarget, setRevokeInviteTarget] = useState<WorkspaceInvite | null>(null);

  async function refresh() {
    const [workspacesData, invitesData] = await Promise.all([
      apiFetch<{ workspaces: WorkspaceRow[] }>("/platform/workspaces"),
      apiFetch<{ invites: WorkspaceInvite[] }>("/platform/workspace-invites"),
    ]);
    setWorkspaces(workspacesData?.workspaces ?? []);
    setInvites(invitesData?.invites ?? []);
  }

  useEffect(() => {
    refresh().catch(() => router.push("/platform/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function performRevokeInvite(id: string) {
    setActionBusy(id);
    setActionError(null);
    try {
      await apiFetch(`/platform/workspace-invites/${id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not revoke the invite.");
    } finally {
      setActionBusy(null);
      setRevokeInviteTarget(null);
    }
  }

  async function performToggleStatus(workspace: WorkspaceRow) {
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
      setSuspendTarget(null);
    }
  }

  // Suspending immediately cuts off a live client's widget traffic - it
  // gets a confirm step. Reactivating just turns things back on, is
  // easily reversible, and stays a single click, matching how the
  // conversation reassign confirm only gates the actually-risky direction.
  function handleToggleStatus(workspace: WorkspaceRow) {
    if (workspace.status === "active") {
      setSuspendTarget(workspace);
    } else {
      void performToggleStatus(workspace);
    }
  }

  function handleRevokeInvite(invite: WorkspaceInvite) {
    setRevokeInviteTarget(invite);
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }

  if (!workspaces || !invites) {
    return null;
  }

  const now = new Date();
  const stats = {
    total: workspaces.length,
    active: workspaces.filter((w) => w.status === "active").length,
    suspended: workspaces.filter((w) => w.status === "suspended").length,
    newThisMonth: workspaces.filter((w) => {
      const created = new Date(w.createdAt);
      return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
    }).length,
  };

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold text-slate-900">Workspaces</h1>

      {actionError && <InlineError message={actionError} />}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Clients" value={stats.total} />
        <StatTile label="Active" value={stats.active} />
        <StatTile label="Suspended" value={stats.suspended} tone={stats.suspended > 0 ? "warn" : "default"} />
        <StatTile label="New this month" value={stats.newThisMonth} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">All workspaces</h2>
        {workspaces.length === 0 ? (
          <Card>
            <CardBody className="text-sm text-slate-500">No workspaces yet.</CardBody>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Workspace</TableHeaderCell>
                <TableHeaderCell>Owner</TableHeaderCell>
                <TableHeaderCell>Plan</TableHeaderCell>
                <TableHeaderCell>Widget</TableHeaderCell>
                <TableHeaderCell>Last activity</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {workspaces.map((workspace) => (
                <TableRow key={workspace.id}>
                  <TableCell>
                    <Link href={`/platform/workspaces/${workspace.id}`} className="font-medium text-slate-900 hover:underline">
                      {workspace.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {workspace.slug} · {workspace.userCount} user{workspace.userCount === 1 ? "" : "s"}
                    </div>
                  </TableCell>
                  <TableCell>{workspace.ownerEmail ?? "no owner"}</TableCell>
                  <TableCell>{workspace.plan ?? "no plan set"}</TableCell>
                  <TableCell>{workspace.widgetConfigured ? "Configured" : "Not configured"}</TableCell>
                  <TableCell>{formatRelativeTime(workspace.lastActivityAt)}</TableCell>
                  <TableCell>
                    <Badge tone={workspace.status === "active" ? "success" : "danger"}>{workspace.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => handleToggleStatus(workspace)}
                      disabled={actionBusy === workspace.id}
                      className={cn(
                        "hover:underline disabled:opacity-50",
                        workspace.status === "active" ? "text-red-600" : "text-slate-600",
                      )}
                    >
                      {workspace.status === "active" ? "Suspend" : "Reactivate"}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Card>
        <CardHeader title="Provision a new client" />
        <CardBody className="flex flex-col gap-4">
          {revealedInviteUrl && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="mb-1 font-medium text-amber-800">
                Share this link with them - there&apos;s no automatic email yet, so this is the only way they&apos;ll get it.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all">{revealedInviteUrl}</code>
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(revealedInviteUrl)}>
                  Copy
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={handleInvite} className="flex gap-2">
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="new-client@company.com"
              type="email"
              required
              className="flex-1"
            />
            <Button type="submit" disabled={inviting}>
              {inviting ? "Creating..." : "Create signup link"}
            </Button>
          </form>
          {inviteError && <InlineError message={inviteError} />}

          <div>
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Signup links</h3>
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {invites.length === 0 && <li className="p-3 text-sm text-slate-500">No signup links yet.</li>}
              {invites.map((invite) => {
                const expired = new Date(invite.expiresAt).getTime() <= Date.now();
                const state = invite.usedAt ? "used" : expired ? "expired" : "pending";
                return (
                  <li key={invite.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                    <div>
                      <div className="font-medium text-slate-900">{invite.email}</div>
                      <div className="text-slate-500">
                        {state} · created {new Date(invite.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    {state === "pending" && (
                      <button
                        onClick={() => handleRevokeInvite(invite)}
                        disabled={actionBusy === invite.id}
                        className="shrink-0 text-red-600 hover:underline disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={suspendTarget !== null}
        onOpenChange={(open) => !open && setSuspendTarget(null)}
        title={`Suspend ${suspendTarget?.name}?`}
        description="This immediately stops their widget from accepting new traffic and blocks dashboard logins. You can reactivate at any time."
        confirmLabel="Suspend workspace"
        busy={suspendTarget !== null && actionBusy === suspendTarget.id}
        onConfirm={() => suspendTarget && performToggleStatus(suspendTarget)}
      />

      <ConfirmDialog
        open={revokeInviteTarget !== null}
        onOpenChange={(open) => !open && setRevokeInviteTarget(null)}
        title="Revoke this signup link?"
        description={`${revokeInviteTarget?.email} won't be able to use it to create a workspace anymore.`}
        confirmLabel="Revoke link"
        busy={revokeInviteTarget !== null && actionBusy === revokeInviteTarget.id}
        onConfirm={() => revokeInviteTarget && performRevokeInvite(revokeInviteTarget.id)}
      />
    </div>
  );
}

function StatTile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warn" }) {
  return (
    <Card className="p-3">
      <div className={tone === "warn" && value > 0 ? "text-2xl font-semibold text-red-600" : "text-2xl font-semibold text-slate-900"}>
        {value}
      </div>
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
    </Card>
  );
}
