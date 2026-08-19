"use client";

import type { SessionUser } from "@csa/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export default function DashboardHome() {
  const router = useRouter();
  const [session, setSession] = useState<{ user: SessionUser; workspace: Workspace } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ user: SessionUser; workspace: Workspace }>("/auth/me")
      .then((data) => setSession(data))
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleLogout() {
    await apiFetch("/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (loading || !session) {
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{session.workspace.name}</h1>
          <p className="text-sm text-slate-500">
            {session.user.email} · {session.user.role}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/widget" className="text-sm text-slate-500 underline">
            Chat Widget
          </Link>
          <Link href="/conversations" className="text-sm text-slate-500 underline">
            Conversations
          </Link>
          <Link href="/knowledge" className="text-sm text-slate-500 underline">
            Knowledge
          </Link>
          <Link href="/analytics" className="text-sm text-slate-500 underline">
            Analytics
          </Link>
          <Link href="/integrations" className="text-sm text-slate-500 underline">
            Integrations
          </Link>
          <Link href="/team" className="text-sm text-slate-500 underline">
            Team
          </Link>
          <button onClick={handleLogout} className="text-sm text-slate-500 underline">
            Log out
          </button>
        </div>
      </div>
    </main>
  );
}
