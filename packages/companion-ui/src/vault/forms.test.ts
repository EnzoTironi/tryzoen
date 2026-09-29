import { ZodError } from "zod";
import { expect, it } from "vitest";
import { createVaultFormItem } from "./forms";
import { parseLoginVaultPayload, parsePaymentCardSecret } from "./schema";
const login = {
  nickname: "Mail",
  origin: "example.invalid",
  identifierType: "email",
  identifier: "owner@example.invalid",
  password: "synthetic-secret",
};
it("creates existing canonical password and passwordless login payloads", () => {
  const saved = createVaultFormItem("login", login);
  expect(parseLoginVaultPayload(saved.secret)).toMatchObject({
    origin: "https://example.invalid",
    authentication: { type: "password", password: "synthetic-secret" },
  });
  expect(
    parseLoginVaultPayload(
      createVaultFormItem("login", { ...login, password: "" }).secret
    )
  ).toMatchObject({ authentication: { type: "email_otp" } });
});
it("rejects invalid origins, identifiers and passwordless usernames", () => {
  expect(() =>
    createVaultFormItem("login", { ...login, origin: "file:///tmp" })
  ).toThrow(ZodError);
  expect(() =>
    createVaultFormItem("login", { ...login, identifier: "invalid" })
  ).toThrow(ZodError);
  expect(() =>
    createVaultFormItem("login", {
      ...login,
      identifierType: "username",
      password: "",
    })
  ).toThrow(ZodError);
});
const card = {
  nickname: "",
  cardholderName: "Synthetic Card",
  cardNumber: "4242424242424242",
  expiration: "12 / 99",
  cvc: "123",
  billingPostalCode: "00000",
};
it("uses the existing structured card serializer and masked default title", () => {
  const saved = createVaultFormItem("payment", card);
  expect(saved.label).toBe("Visa 4242");
  expect(parsePaymentCardSecret(saved.secret)).toMatchObject({
    number: card.cardNumber,
    securityCode: "123",
    expirationYear: 2099,
  });
});
it("retains card checksum, expiration and required-field validation", () => {
  expect(() =>
    createVaultFormItem("payment", { ...card, cardNumber: "4242424242424241" })
  ).toThrow(ZodError);
  expect(() =>
    createVaultFormItem("payment", { ...card, expiration: "01 / 00" })
  ).toThrow(ZodError);
  expect(() => createVaultFormItem("payment", { ...card, cvc: "" })).toThrow(
    ZodError
  );
});

it.each(["12/99", "1299", "12 /99", "12 / 99"])(
  "normalizes ordinary expiry entry %s",
  (expiration) => {
    expect(
      parsePaymentCardSecret(
        createVaultFormItem("payment", { ...card, expiration }).secret
      )
    ).toMatchObject({ expirationMonth: 12, expirationYear: 2099 });
  }
);
