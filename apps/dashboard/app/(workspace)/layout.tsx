import { redirect } from "next/navigation";
import type { PropsWithChildren } from "react";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { WorkspaceSessionProvider } from "@/lib/session-context";
import { getWorkspaceSession } from "@/lib/session-server";

export default async function WorkspaceLayout({ children }: PropsWithChildren) {
  const session = await getWorkspaceSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <WorkspaceSessionProvider initialSession={session}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceSessionProvider>
  );
}
