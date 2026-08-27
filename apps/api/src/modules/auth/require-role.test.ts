import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../errors.js";
import { requireRole } from "./require-role.js";

describe("requireRole", () => {
  it("allows a role that's in the allowed list", () => {
    expect(() => requireRole("owner", ["owner", "administrator"], "not allowed")).not.toThrow();
  });

  it("throws ForbiddenError for a role not in the allowed list", () => {
    expect(() => requireRole("support_agent", ["owner", "administrator"], "not allowed")).toThrow(ForbiddenError);
  });

  it("throws with the exact message passed in", () => {
    expect(() => requireRole("support_agent", ["owner"], "Only owners can do this.")).toThrow(
      "Only owners can do this.",
    );
  });

  it("rejects when the allowed list is empty, regardless of role", () => {
    expect(() => requireRole("owner", [], "nothing allowed")).toThrow(ForbiddenError);
  });
});
