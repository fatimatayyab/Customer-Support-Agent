"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InlineError } from "@/components/ui/error-state";
import { Input, Select } from "@/components/ui/field";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";

type Role = "owner" | "administrator" | "support_agent";

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  createdAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  administrator: "Administrator",
  support_agent: "Support Agent",
};

export default function TeamPage() {
  const router = useRouter();
  const { user: sessionUser } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("support_agent");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [revealedInviteUrl, setRevealedInviteUrl] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh() {
    const [membersData, invitationsData] = await Promise.all([
      apiFetch<{ users: Member[] }>("/workspaces/users"),
      apiFetch<{ invitations: Invitation[] }>("/workspaces/invitations"),
    ]);
    setMembers(membersData?.users ?? []);
    setInvitations(invitationsData?.invitations ?? []);
  }

  useEffect(() => {
    refresh().catch(() => router.push("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    setInviteError(null);
    setRevealedInviteUrl(null);
    try {
      const result = await apiFetch<{ inviteUrl: string }>("/workspaces/invitations", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      if (result) {
        setRevealedInviteUrl(result.inviteUrl);
        setEmail("");
        await refresh();
      }
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Could not send invitation.");
    } finally {
      setInviting(false);
    }
  }

  async function handleResend(invitation: Invitation) {
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await apiFetch<{ inviteUrl: string }>("/workspaces/invitations", {
        method: "POST",
        body: JSON.stringify({ email: invitation.email, role: invitation.role }),
      });
      if (result) {
        setRevealedInviteUrl(result.inviteUrl);
        await refresh();
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not resend the invitation.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/workspaces/invitations/${id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not revoke the invitation.");
    } finally {
      setActionBusy(false);
    }
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }

  if (!members || !invitations) {
    return null;
  }

  const canInviteOwner = sessionUser.role === "owner";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-slate-900">Team</h1>

      <Card>
        <CardHeader title="Members" />
        <ul className="divide-y divide-slate-100">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between p-4 text-sm">
              <div>
                <div className="font-medium text-slate-900">{member.name}</div>
                <div className="text-slate-500">{member.email}</div>
              </div>
              <span className="text-slate-500">{ROLE_LABELS[member.role]}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Pending invitations" />
        <CardBody className="flex flex-col gap-4">
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {invitations.length === 0 && <li className="p-3 text-sm text-slate-500">No pending invitations.</li>}
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{invitation.email}</div>
                  <div className="text-slate-500">
                    {ROLE_LABELS[invitation.role]} · invited by {invitation.invitedByName} · expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex shrink-0 gap-3">
                  {(invitation.role !== "owner" || canInviteOwner) && (
                    <button
                      onClick={() => handleResend(invitation)}
                      disabled={actionBusy}
                      className="text-sm text-slate-600 hover:underline disabled:opacity-50"
                    >
                      Resend
                    </button>
                  )}
                  <button
                    onClick={() => handleRevoke(invitation.id)}
                    disabled={actionBusy}
                    className="text-sm text-red-600 hover:underline disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {actionError && <InlineError message={actionError} />}

          {revealedInviteUrl && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="mb-1 font-medium text-amber-800">
                Share this link with them - there's no automatic email yet, so this is the only way they'll get it.
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
              placeholder="teammate@company.com"
              type="email"
              required
              className="flex-1"
            />
            <Select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              <option value="support_agent">Support Agent</option>
              <option value="administrator">Administrator</option>
              {canInviteOwner && <option value="owner">Owner</option>}
            </Select>
            <Button type="submit" disabled={inviting}>
              {inviting ? "Sending..." : "Invite"}
            </Button>
          </form>
          {inviteError && <InlineError message={inviteError} />}
        </CardBody>
      </Card>
    </div>
  );
}
