"use client";

import type { SessionUser } from "@csa/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";

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
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
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
    apiFetch<{ user: SessionUser }>("/auth/me")
      .then((data) => setSessionUser(data?.user ?? null))
      .catch(() => router.push("/login"));
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

  if (!members || !invitations || !sessionUser) {
    return null;
  }

  const canInviteOwner = sessionUser.role === "owner";

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Team</h1>
        <Link href="/" className="text-sm text-slate-500 underline">
          Back
        </Link>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Members</h2>
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <div className="font-medium">{member.name}</div>
                <div className="text-slate-500">{member.email}</div>
              </div>
              <span className="text-slate-500">{ROLE_LABELS[member.role]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Pending invitations</h2>
        <ul className="mb-4 divide-y divide-slate-200 rounded-md border border-slate-200">
          {invitations.length === 0 && <li className="p-3 text-sm text-slate-500">No pending invitations.</li>}
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between gap-4 p-3 text-sm">
              <div>
                <div className="font-medium">{invitation.email}</div>
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
                    className="text-slate-600 underline disabled:opacity-50"
                  >
                    Resend
                  </button>
                )}
                <button
                  onClick={() => handleRevoke(invitation.id)}
                  disabled={actionBusy}
                  className="text-red-600 underline disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
        {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

        {revealedInviteUrl && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="mb-1 font-medium text-amber-800">
              Share this link with them - there's no automatic email yet, so this is the only way they'll get it.
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

        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@company.com"
            type="email"
            required
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className="rounded-md border border-slate-300 px-2 py-2 text-sm"
          >
            <option value="support_agent">Support Agent</option>
            <option value="administrator">Administrator</option>
            {canInviteOwner && <option value="owner">Owner</option>}
          </select>
          <button
            type="submit"
            disabled={inviting}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {inviting ? "Sending..." : "Invite"}
          </button>
        </form>
        {inviteError && <p className="mt-2 text-sm text-red-600">{inviteError}</p>}
      </section>
    </main>
  );
}
