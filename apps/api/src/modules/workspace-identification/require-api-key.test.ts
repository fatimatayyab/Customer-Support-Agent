import type { FastifyReply, FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateWorkspaceStatusForPlatform, withWorkspaceContext } from "@csa/db";
import { createWorkspace } from "../../test-support/fixtures.js";
import { insertApiKey } from "../workspaces/api-key.repository.js";
import { generateApiKey } from "./api-key.js";
import { requireApiKey } from "./require-api-key.js";

function fakeRequest(headers: Record<string, string | undefined>): FastifyRequest {
  return { headers, log: { error: () => {} } } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & { statusCode: number | null } {
  const state = { statusCode: null as number | null };
  const reply = {
    code(status: number) {
      state.statusCode = status;
      return reply;
    },
    send() {
      return reply;
    },
  } as unknown as FastifyReply & { statusCode: number | null };
  Object.defineProperty(reply, "statusCode", { get: () => state.statusCode });
  return reply;
}

async function createApiKey(workspaceId: string, allowedOrigins: string[] | null = null) {
  const { rawKey, keyPrefix, keyHash } = generateApiKey();
  await withWorkspaceContext(workspaceId, (scopedDb) =>
    insertApiKey(scopedDb, { workspaceId, name: "Test key", keyPrefix, keyHash, allowedOrigins }),
  );
  return rawKey;
}

describe("requireApiKey", () => {
  it("attaches workspaceId for a valid, active, unrestricted key", async () => {
    const workspace = await createWorkspace();
    const rawKey = await createApiKey(workspace.id);
    const request = fakeRequest({ "x-api-key": rawKey });
    const reply = fakeReply();

    await requireApiKey(request, reply);

    expect(request.workspaceId).toBe(workspace.id);
    expect(reply.statusCode).toBeNull();
  });

  it("returns 401 with no X-API-Key header", async () => {
    const request = fakeRequest({});
    const reply = fakeReply();

    await requireApiKey(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(request.workspaceId).toBeUndefined();
  });

  it("returns 401 for a key that doesn't exist", async () => {
    const request = fakeRequest({ "x-api-key": "csa_live_" + "0".repeat(64) });
    const reply = fakeReply();

    await requireApiKey(request, reply);

    expect(reply.statusCode).toBe(401);
  });

  it("returns 401 for a workspace-A key resolving to workspace-A only, never a different workspace", async () => {
    const workspaceA = await createWorkspace();
    const workspaceB = await createWorkspace();
    const rawKey = await createApiKey(workspaceA.id);
    const request = fakeRequest({ "x-api-key": rawKey });
    const reply = fakeReply();

    await requireApiKey(request, reply);

    expect(request.workspaceId).toBe(workspaceA.id);
    expect(request.workspaceId).not.toBe(workspaceB.id);
  });

  it("returns 401 once the workspace is suspended, even with an otherwise-valid key", async () => {
    const workspace = await createWorkspace();
    const rawKey = await createApiKey(workspace.id);
    await updateWorkspaceStatusForPlatform(workspace.id, "suspended");

    const request = fakeRequest({ "x-api-key": rawKey });
    const reply = fakeReply();

    await requireApiKey(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(request.workspaceId).toBeUndefined();
  });

  it("enforces an origin allowlist when one is set on the key", async () => {
    const workspace = await createWorkspace();
    const rawKey = await createApiKey(workspace.id, ["allowed.example.test"]);

    const blocked = fakeRequest({ "x-api-key": rawKey, origin: "https://not-allowed.example.test" });
    const blockedReply = fakeReply();
    await requireApiKey(blocked, blockedReply);
    expect(blockedReply.statusCode).toBe(401);

    const allowed = fakeRequest({ "x-api-key": rawKey, origin: "https://allowed.example.test" });
    const allowedReply = fakeReply();
    await requireApiKey(allowed, allowedReply);
    expect(allowedReply.statusCode).toBeNull();
    expect(allowed.workspaceId).toBe(workspace.id);
  });

  it("fails closed (401) when a restricted key's request has no Origin header at all", async () => {
    const workspace = await createWorkspace();
    const rawKey = await createApiKey(workspace.id, ["allowed.example.test"]);
    const request = fakeRequest({ "x-api-key": rawKey });
    const reply = fakeReply();

    await requireApiKey(request, reply);

    expect(reply.statusCode).toBe(401);
  });
});
