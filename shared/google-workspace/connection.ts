import { isValid } from "@shared/validation";
import { z } from "zod";

const chatReturnPathSchema = z
  .string()
  .refine((value) => value === value.trim(), "Expected trimmed text")
  .regex(/^\/chat\/(?!history$)[A-Za-z0-9_-]{1,256}$/u);

const companionReturnPathSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      /[\\\s#]/u.test(value)
    )
      return false;
    const url = new URL(value, "https://zoen.invalid");
    if (
      url.origin !== "https://zoen.invalid" ||
      value.split("?")[0] !== url.pathname
    )
      return false;
    if (
      !["/", "/onboarding", "/companion"].includes(url.pathname) &&
      !/^\/companion\/[A-Za-z0-9_-]{1,256}$/u.test(url.pathname)
    )
      return false;
    return [...url.searchParams.keys()].every((key) =>
      [
        "step",
        "callbackUrl",
        "space",
        "view",
        "compose",
        "room",
        "draft",
        "google",
      ].includes(key)
    );
  });

/** Connection callbacks stay in the app's conversation or onboarding flow. */
export function googleWorkspaceReturnTo(
  value: string | readonly string[] | undefined
) {
  return isValid(chatReturnPathSchema, value) ||
    isValid(companionReturnPathSchema, value)
    ? value
    : "/";
}

export const googleWorkspaceScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/contacts.readonly",
] as const;
