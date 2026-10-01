import { beforeEach, expect, test, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { symmetricEncrypt } from "better-auth/crypto";
import {
  connectorRequestFingerprint,
  redactConnectorCredential,
  sealConnectorCredential,
  openConnectorCredential,
} from "./credentials";

test.each([
  "synthetic-key-123",
  'synthetic-"quoted"-key',
  "synthetic\\path-key",
])(
  "redacts raw and common encoded echoes of a connector credential",
  (credential) => {
    const serialized = JSON.stringify({
      description: `The service returned ${credential}`,
      content: Buffer.from(credential).toString("base64"),
      url: encodeURIComponent(credential),
    });
    expect(
      JSON.parse(redactConnectorCredential(serialized, credential))
    ).toEqual({
      description: "The service returned [redacted]",
      content: "[redacted]",
      url: "[redacted]",
    });
  }
);

const syntheticKey = "synthetic-connector-test-key-at-least-32-bytes";
vi.mock("@db/services/auth", () => ({
  getAuth: async () => ({
    $context: Promise.resolve({
      secretConfig: {
        currentVersion: 1,
        keys: new Map([[1, "synthetic-connector-test-key-at-least-32-bytes"]]),
      },
    }),
  }),
}));
const scope = {
  workspaceId: "personal-alice",
  id: "d60420cc-d208-41cf-b7ba-940ac08c0e3e",
  revision: "23e70990-050b-4173-a811-c45b630ff973",
};
const postgresCredential = {
  kind: "postgres" as const,
  value: { username: "reader", password: "synthetic\npassword" },
};

test.each([
  { kind: "mcp" as const, value: "synthetic-token" },
  { kind: "openapi" as const, value: "synthetic-token" },
  postgresCredential,
])(
  "round-trips typed credential with actual encryption, never exposing plaintext",
  async (credential) => {
    const encrypted = await sealConnectorCredential(scope, credential);
    expect(encrypted).not.toContain("synthetic");
    expect(
      await openConnectorCredential(scope, credential.kind, encrypted)
    ).toEqual(credential);
  }
);
test.each([
  { ...scope, workspaceId: "company-studio" },
  { ...scope, id: "3aabeb77-3dd4-4d0f-ac04-be8886452d47" },
  { ...scope, revision: "4b14fa3f-420c-408c-9802-fae40312ab72" },
])(
  "rejects encrypted credential transplanted across scope/revision %#",
  async (target) => {
    const encrypted = await sealConnectorCredential(scope, postgresCredential);
    await expect(
      openConnectorCredential(target, "postgres", encrypted)
    ).rejects.toMatchObject({ reason: "denied" });
  }
);
test.each(["mcp", "openapi"] as const)(
  "rejects a PostgreSQL envelope used as %s",
  async (kind) => {
    const encrypted = await sealConnectorCredential(scope, postgresCredential);
    await expect(
      openConnectorCredential(scope, kind, encrypted)
    ).rejects.toMatchObject({ reason: "denied" });
  }
);
test("binds HTTP kind as well as scope and revision", async () => {
  const encrypted = await sealConnectorCredential(scope, {
    kind: "mcp",
    value: "synthetic-token",
  });
  await expect(
    openConnectorCredential(scope, "openapi", encrypted)
  ).rejects.toMatchObject({ reason: "denied" });
});
test("requires reconnect for the obsolete untyped envelope; never silently dual-reads", async () => {
  const encrypted = await symmetricEncrypt({
    key: { currentVersion: 1, keys: new Map([[1, syntheticKey]]) },
    data: JSON.stringify({
      purpose: "tool-connector",
      ...scope,
      value: "old-synthetic-token",
    }),
  });
  await expect(
    openConnectorCredential(scope, "mcp", encrypted)
  ).rejects.toMatchObject({ reason: "denied" });
});
test("rejects malformed ciphertext without returning secret material", async () => {
  await expect(
    openConnectorCredential(scope, "postgres", "not-encrypted")
  ).rejects.toMatchObject({ reason: "unavailable" });
});

const installation = vi.hoisted(() => ({
  read: vi.fn<() => Promise<{ secretEncryptionKey: string }>>(),
}));
vi.mock("@db/services/installation-secrets", () => ({
  getInstallationSecrets: installation.read,
}));
const fingerprintKey = Buffer.alloc(32, 1).toString("base64");
const requestScope = {
  workspaceId: scope.workspaceId,
  userId: "better-auth:alice",
};
const request = {
  id: scope.id,
  name: "Studio",
  kind: "postgres" as const,
  configuration: {
    host: "db.example.com",
    port: 5432,
    database: "studio",
    tls: "verify-full" as const,
  },
  credential: postgresCredential.value,
  share: "owner" as const,
};
beforeEach(() => {
  installation.read
    .mockReset()
    .mockResolvedValue({ secretEncryptionKey: fingerprintKey });
});
test("retry fingerprint uses the existing key and explicit request domain, never plain password SHA256", async () => {
  const fingerprint = await connectorRequestFingerprint(requestScope, request);
  expect(fingerprint).toBe(
    createHmac("sha256", Buffer.from(fingerprintKey, "base64"))
      .update(
        JSON.stringify([
          "zoen:tool-connector:request:v1",
          requestScope.workspaceId,
          requestScope.userId,
          request,
        ])
      )
      .digest("hex")
  );
  expect(fingerprint).not.toBe(
    createHash("sha256").update(JSON.stringify(request)).digest("hex")
  );
  expect(fingerprint).not.toContain(request.credential.password);
  expect(await connectorRequestFingerprint(requestScope, request)).toBe(
    fingerprint
  );
});
test.each([
  { ...requestScope, workspaceId: "company-studio" },
  { ...requestScope, userId: "better-auth:bob" },
])("fingerprint binds exact workspace and actor %#", async (target) => {
  expect(await connectorRequestFingerprint(target, request)).not.toBe(
    await connectorRequestFingerprint(requestScope, request)
  );
});
test.each([
  {
    ...request,
    credential: { ...request.credential, password: "another-synthetic-secret" },
  },
  {
    ...request,
    credential: { ...request.credential, username: "other-reader" },
  },
  {
    ...request,
    configuration: { ...request.configuration, database: "other" },
  },
  { ...request, share: "workspace" as const },
])(
  "fingerprint binds credential and exact submitted configuration %#",
  async (changed) => {
    expect(await connectorRequestFingerprint(requestScope, changed)).not.toBe(
      await connectorRequestFingerprint(requestScope, request)
    );
  }
);
test("different installation key cannot reproduce the same password verifier", async () => {
  const first = await connectorRequestFingerprint(requestScope, request);
  installation.read.mockResolvedValue({
    secretEncryptionKey: Buffer.alloc(32, 2).toString("base64"),
  });
  expect(await connectorRequestFingerprint(requestScope, request)).not.toBe(
    first
  );
});
test("key lookup failure fails closed without leaking key error/credential material", async () => {
  installation.read.mockRejectedValue(new Error(request.credential.password));
  await expect(
    connectorRequestFingerprint(requestScope, request)
  ).rejects.toMatchObject({ reason: "unavailable", message: "ConnectorError" });
});
