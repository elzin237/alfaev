import { describe, expect, it } from "vitest";

import { userInviteSchema } from "./userInviteSchema";

describe("userInviteSchema", () => {
  it("rejects impossible dates and overlong identity fields", () => {
    const invalidDate = userInviteSchema.safeParse({
      fullName: "Ada Admin",
      email: "ada@example.com",
      birthday: "2026-02-30",
      isAdmin: false,
    });
    const overlongValues = userInviteSchema.safeParse({
      fullName: "A".repeat(201),
      email: `${"a".repeat(309)}@example.com`,
      birthday: "1990-01-02",
      isAdmin: false,
    });

    expect(invalidDate.success).toBe(false);
    expect(overlongValues.success).toBe(false);
  });

  it("normalizes valid name and email input while preserving Admin status", () => {
    expect(
      userInviteSchema.parse({
        fullName: "  Ada   Admin  ",
        email: " ADA@EXAMPLE.COM ",
        birthday: "1990-01-02",
        isAdmin: true,
      }),
    ).toEqual({
      fullName: "Ada Admin",
      email: "ada@example.com",
      birthday: "1990-01-02",
      isAdmin: true,
    });
  });
});
