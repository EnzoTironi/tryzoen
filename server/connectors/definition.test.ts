import { expect, test } from "vitest";
import {
  ConnectionSchema,
  ConnectorInput,
  PostgresCredentialSchema,
} from "./definition";

const identity = {
  id: "d60420cc-d208-41cf-b7ba-940ac08c0e3e",
  revision: "23e70990-050b-4173-a811-c45b630ff973",
  name: "Synthetic studio",
  connected_by: "better-auth:alice",
  share: "owner" as const,
};
const endpoint = {
  host: "db.example.com",
  port: 5432,
  database: "studio",
  tls: "verify-full" as const,
};
const postgres = {
  ...identity,
  kind: "postgres",
  endpoint: null,
  operations: null,
  postgres_config: endpoint,
};
const operation = {
  id: "read",
  name: "Read",
  description: "Read notes",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  request: { kind: "mcp", structured: true },
};
const remote = {
  ...identity,
  kind: "mcp",
  endpoint: "https://example.com/mcp",
  operations: [operation],
  postgres_config: null,
};

test("decodes exclusive SQL-null HTTP/PostgreSQL registry variants", () => {
  expect(ConnectionSchema.parse(postgres)).toEqual(postgres);
  expect(ConnectionSchema.parse(remote)).toEqual(remote);
});
test.each([
  { ...postgres, operations: [] },
  { ...postgres, endpoint: "postgres://db.example.com" },
  { ...postgres, postgres_config: null },
  { ...postgres, postgres_config: "null" },
  { ...postgres, postgres_config: { ...endpoint, password: "secret" } },
  { ...postgres, postgres_config: { ...endpoint, tls: "disable" } },
  { ...remote, postgres_config: endpoint },
  { ...remote, operations: [] },
  { ...remote, endpoint: null },
  { ...remote, credentials: "secret" },
])("rejects mixed, secret-bearing or malformed DTO %#", (input) => {
  expect(ConnectionSchema.safeParse(input).success).toBe(false);
});
test("normalizes the canonical endpoint before registration hashing", () => {
  const input = {
    id: identity.id,
    name: identity.name,
    share: identity.share,
    kind: "postgres",
    configuration: { ...endpoint, host: "DB.Example.Com" },
    credential: { username: "studio reader", password: "synthetic\npassword" },
  };
  expect(ConnectorInput.parse(input)).toEqual({
    ...input,
    configuration: endpoint,
  });
  expect(
    ConnectorInput.safeParse({ ...input, document: "HTTP-only" }).success
  ).toBe(false);
  expect(
    ConnectorInput.safeParse({ ...input, endpoint: "postgres://example.com" })
      .success
  ).toBe(false);
});
test.each(["nul\0password", "bad\ud800", "😀".repeat(2001)])(
  "rejects malformed or byte-oversize PostgreSQL secrets %#",
  (password) => {
    expect(
      PostgresCredentialSchema.safeParse({ username: "reader", password })
        .success
    ).toBe(false);
  }
);
test("uses the canonical PostgreSQL identifier bounds for the private username", () => {
  expect(
    PostgresCredentialSchema.safeParse({
      username: "a".repeat(64),
      password: "synthetic",
    }).success
  ).toBe(false);
  expect(
    PostgresCredentialSchema.safeParse({
      username: "😀".repeat(15),
      password: "😀".repeat(2000),
    }).success
  ).toBe(true);
});
test("HTTP credentials reject line breaks independently of PostgreSQL passwords", () => {
  const input = {
    id: identity.id,
    name: identity.name,
    share: identity.share,
    kind: "mcp",
    endpoint: remote.endpoint,
    credential: "bad\r\nheader",
  };
  expect(ConnectorInput.safeParse(input).success).toBe(false);
  expect(
    ConnectorInput.safeParse({ ...input, credential: "synthetic" }).success
  ).toBe(true);
});
