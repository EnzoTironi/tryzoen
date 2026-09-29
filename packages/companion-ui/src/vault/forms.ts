import { z } from "zod";
import {
  loginIdentifierSchema,
  loginIdentifierTypeSchema,
  loginOriginSchema,
  serializeLoginVaultPayload,
  serializePaymentCard,
  paymentCardBrand,
  vaultCreateItemSchema,
} from "./schema";
export const loginFormSchema = z
  .object({
    identifier: z.string().trim(),
    identifierType: loginIdentifierTypeSchema,
    nickname: z.string().trim().min(1, "Enter a name for this login.").max(120),
    origin: z
      .string()
      .trim()
      .transform(normalizeLoginOrigin)
      .pipe(loginOriginSchema),
    password: z.string().max(20_000),
  })
  .superRefine((form, context) => {
    const identifier = loginIdentifierSchema.safeParse({
      type: form.identifierType,
      value: form.identifier,
    });
    if (!identifier.success) {
      for (const issue of identifier.error.issues) {
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: ["identifier"],
        });
      }
    }
    if (form.identifierType === "username" && !form.password) {
      context.addIssue({
        code: "custom",
        message: "Username logins require a password.",
        path: ["password"],
      });
    }
  });

function loginAuthentication(form: z.output<typeof loginFormSchema>) {
  if (form.password) {
    return { password: form.password, type: "password" as const };
  }
  if (form.identifierType === "email") return { type: "email_otp" as const };
  if (form.identifierType === "phone") return { type: "sms_otp" as const };
  throw new Error("Username logins require a password.");
}

function normalizeLoginOrigin(value: string) {
  const candidate = value.includes("://") ? value : `https://${value}`;
  try {
    return new URL(candidate).origin;
  } catch {
    return value;
  }
}
export const paymentCardFormSchema = z.object({
  billingPostalCode: z.string().trim().min(1, "Enter the billing postal code."),
  cardNumber: z
    .string()
    .transform((value) => value.replaceAll(/\D/gu, ""))
    .pipe(z.string().regex(/^\d{12,19}$/u, "Enter a valid card number."))
    .refine(passesLuhnCheck, "Check the card number."),
  cardholderName: z.string().trim().min(1, "Enter the name on the card."),
  cvc: z
    .string()
    .transform((value) => value.replaceAll(/\D/gu, ""))
    .pipe(z.string().regex(/^\d{3,4}$/u, "Enter a valid CVC.")),
  expiration: z
    .string()
    .trim()
    .transform((value) =>
      value.replace(/^(\d{2})\s*\/?\s*(\d{2})$/u, "$1 / $2")
    )
    .pipe(z.string().regex(/^(0[1-9]|1[0-2]) \/ \d{2}$/u, "Use MM / YY."))
    .refine(isCurrentExpiration, "Use a current expiration date."),
  nickname: z.string().trim().max(120),
});

function passesLuhnCheck(number: string) {
  let sum = 0;
  let doubleDigit = false;

  for (let index = number.length - 1; index >= 0; index--) {
    let digit = Number(number[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

function isCurrentExpiration(value: string) {
  const [month, shortYear] = value.split(" / ");
  if (month === undefined || shortYear === undefined) return false;

  const expirationYear = 2000 + Number(shortYear);
  const today = new Date();
  return (
    expirationYear > today.getFullYear() ||
    (expirationYear === today.getFullYear() &&
      Number(month) >= today.getMonth() + 1)
  );
}

export function createVaultFormItem(kind: "login" | "payment", raw: unknown) {
  if (kind === "login") {
    const form = loginFormSchema.parse(raw);
    return vaultCreateItemSchema.parse({
      kind,
      label: form.nickname,
      secret: serializeLoginVaultPayload({
        kind: "login",
        version: 2,
        origin: form.origin,
        identifier: { type: form.identifierType, value: form.identifier },
        authentication: loginAuthentication(form),
      }),
    });
  }
  const form = paymentCardFormSchema.parse(raw);
  const [month, year] = form.expiration.split(" / ");
  return vaultCreateItemSchema.parse({
    kind,
    label:
      form.nickname ||
      `${paymentCardBrand(form.cardNumber)} ${form.cardNumber.slice(-4)}`,
    secret: serializePaymentCard({
      kind: "payment-card",
      version: 1,
      billingPostalCode: form.billingPostalCode,
      cardholderName: form.cardholderName,
      expirationMonth: Number(month),
      expirationYear: 2000 + Number(year),
      number: form.cardNumber,
      securityCode: form.cvc,
    }),
  });
}
