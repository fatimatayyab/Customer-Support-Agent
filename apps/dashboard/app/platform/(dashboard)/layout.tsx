import { redirect } from "next/navigation";
import type { PropsWithChildren } from "react";
import { PlatformShell } from "@/components/shell/platform-shell";
import { PlatformSessionProvider } from "@/lib/session-context";
import { getPlatformSession } from "@/lib/session-server";

export default async function PlatformDashboardLayout({ children }: PropsWithChildren) {
  const admin = await getPlatformSession();
  if (!admin) {
    redirect("/platform/login");
  }

  return (
    <PlatformSessionProvider initialAdmin={admin}>
      <PlatformShell>{children}</PlatformShell>
    </PlatformSessionProvider>
  );
}
