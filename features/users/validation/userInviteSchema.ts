import { z } from "zod";

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export const userInviteSchema = z
  .object({
    fullName: z
      .string()
      .transform((value) => value.trim().replace(/\s+/g, " "))
      .pipe(
        z
          .string()
          .min(1, "Full name is required.")
          .max(200, "Full name must not exceed 200 characters."),
      ),
    email: z
      .string()
      .trim()
      .min(1, "Email is required.")
      .max(320, "Email must not exceed 320 characters.")
      .email("Enter a valid email address.")
      .transform((value) => value.toLowerCase()),
    birthday: z
      .string()
      .min(1, "Birthday is required.")
      .refine(isValidCalendarDate, "Enter a valid birthday."),
    isAdmin: z.boolean(),
  })
  .strict();

export type UserInviteFormInput = z.input<typeof userInviteSchema>;
export type UserInviteInput = z.output<typeof userInviteSchema>;
