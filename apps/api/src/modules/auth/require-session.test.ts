import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "@csa/shared";
import { requireSession } from "./require-session.js";
import { SESSION_COOKIE_NAME, signSessionToken } from "./session-token.js";

const SAMPLE_SESSION: SessionUser = {
  userId: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  role: "owner",
  email: "owner@example.test",
};

function fakeRequest(cookieValue: string | undefined): FastifyRequest {
  return { cookies: cookieValue === undefined ? {} : { [SESSION_COOKIE_NAME]: cookieValue } } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & { statusCode: number | null; body: unknown } {
  const state = { statusCode: null as number | null, body: undefined as unknown };
  const reply = {
    code(status: number) {
      state.statusCode = status;
      return reply;
    },
    send(payload: unknown) {
      state.body = payload;
      return reply;
    },
  } as unknown as FastifyReply & { statusCode: number | null; body: unknown };
  Object.defineProperty(reply, "statusCode", { get: () => state.statusCode });
  Object.defineProperty(reply, "body", { get: () => state.body });
  return reply;
}

describe("requireSession", () => {
  it("attaches sessionUser and workspaceId for a valid session cookie", async () => {
    const token = await signSessionToken(SAMPLE_SESSION);
    const request = fakeRequest(token);
    const reply = fakeReply();

    await requireSession(request, reply);

    // toMatchObject, not toEqual: verifySessionToken returns the JWT's
    // full payload (jose's decoded claims include iat/exp alongside the
    // SessionUser fields), which request.sessionUser is cast from as-is -
    // those extra claims are expected and harmless, not a bug to assert
    // away.
    expect(request.sessionUser).toMatchObject(SAMPLE_SESSION);
    expect(request.workspaceId).toBe(SAMPLE_SESSION.workspaceId);
    expect(reply.statusCode).toBeNull();
  });

  it("returns 401 with no session cookie at all", async () => {
    const request = fakeRequest(undefined);
    const reply = fakeReply();

    await requireSession(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(request.sessionUser).toBeUndefined();
    expect(request.workspaceId).toBeUndefined();
  });

  it("returns 401 for a garbage/invalid cookie value", async () => {
    const request = fakeRequest("not-a-real-jwt");
    const reply = fakeReply();

    await requireSession(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(request.sessionUser).toBeUndefined();
  });

  it("returns 401 for a token signed with a different secret", async () => {
    const { SignJWT } = await import("jose");
    const wrongSecret = new TextEncoder().encode("a".repeat(32));
    const token = await new SignJWT({ ...SAMPLE_SESSION })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(wrongSecret);

    const request = fakeRequest(token);
    const reply = fakeReply();

    await requireSession(request, reply);

    expect(reply.statusCode).toBe(401);
  });

  it("returns 401 for an expired token", async () => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.SESSION_JWT_SECRET);
    const token = await new SignJWT({ ...SAMPLE_SESSION })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("-1s")
      .sign(secret);

    const request = fakeRequest(token);
    const reply = fakeReply();

    await requireSession(request, reply);

    expect(reply.statusCode).toBe(401);
  });
});
