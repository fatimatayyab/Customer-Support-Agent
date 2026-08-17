import type { PlatformAdminSession, SessionUser } from "@csa/shared";

declare module "fastify" {
  interface FastifyRequest {
    workspaceId?: string;
    sessionUser?: SessionUser;
    // Structurally separate from sessionUser - a request is never both.
    platformAdmin?: PlatformAdminSession;
  }
}
