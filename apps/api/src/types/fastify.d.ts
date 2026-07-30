import type { SessionUser } from "@csa/shared";

declare module "fastify" {
  interface FastifyRequest {
    workspaceId?: string;
    sessionUser?: SessionUser;
  }
}
