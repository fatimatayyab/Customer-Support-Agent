import { SignJWT, jwtVerify } from "jose";
import { env } from "../../config/env.js";

const secret = new TextEncoder().encode(env.SESSION_JWT_SECRET);
const TICKET_PURPOSE = "widget-ws-ticket";
const TICKET_DURATION = "60s";

/**
 * Browsers can't set custom headers on a WebSocket handshake, so the
 * widget's X-API-Key header can't carry over to the WS upgrade the way
 * it does for plain REST calls. Rather than put the long-lived API key
 * in a query string (logged by proxies, browser history, server access
 * logs), the widget exchanges its API key for one of these short-lived,
 * single-purpose tickets via POST /widget/session first, then opens the
 * WS connection with the ticket instead.
 */
export async function issueWidgetWsTicket(workspaceId: string): Promise<string> {
  return new SignJWT({ workspaceId, purpose: TICKET_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TICKET_DURATION)
    .sign(secret);
}

export async function verifyWidgetWsTicket(ticket: string): Promise<{ workspaceId: string } | null> {
  try {
    const { payload } = await jwtVerify(ticket, secret);
    if (payload.purpose !== TICKET_PURPOSE || typeof payload.workspaceId !== "string") {
      return null;
    }
    return { workspaceId: payload.workspaceId };
  } catch {
    return null;
  }
}
