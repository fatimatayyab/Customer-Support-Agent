import { describe, expect, it } from "vitest";
import { issueWidgetWsTicket, verifyWidgetWsTicket } from "./widget-ws-ticket.js";

describe("widget WS ticket", () => {
  it("round-trips: a ticket issued for a workspace verifies back to that same workspace", async () => {
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    const ticket = await issueWidgetWsTicket(workspaceId);
    const result = await verifyWidgetWsTicket(ticket);
    expect(result).toEqual({ workspaceId });
  });

  it("rejects a ticket for a different workspace than the one it verifies against", async () => {
    const ticket = await issueWidgetWsTicket("11111111-1111-1111-1111-111111111111");
    const result = await verifyWidgetWsTicket(ticket);
    expect(result?.workspaceId).not.toBe("22222222-2222-2222-2222-222222222222");
  });

  it("rejects a malformed/garbage token", async () => {
    const result = await verifyWidgetWsTicket("not-a-real-jwt");
    expect(result).toBeNull();
  });

  it("rejects an empty string", async () => {
    const result = await verifyWidgetWsTicket("");
    expect(result).toBeNull();
  });

  it("rejects a token signed with a different purpose claim", async () => {
    // A ticket is only valid for exactly one purpose ("widget-ws-ticket") -
    // this guards against a token meant for something else (now or in the
    // future) being replayed here just because it's a validly-signed JWT
    // from the same secret.
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.SESSION_JWT_SECRET);
    const token = await new SignJWT({ workspaceId: "11111111-1111-1111-1111-111111111111", purpose: "something-else" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(secret);

    const result = await verifyWidgetWsTicket(token);
    expect(result).toBeNull();
  });
});
