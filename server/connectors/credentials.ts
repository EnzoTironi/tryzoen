import { jsonString } from "@shared/validation";
import { z } from "zod";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@db/services/auth";
import { ConnectorCredentialSchema, ConnectorError } from "./definition";

const CredentialScope = z.strictObject({
  workspaceId: z.string().min(1).max(256),
  id: z.uuid(),
  revision: z.uuid(),
});
const Envelope = z.strictObject({
  purpose: z.literal("tool-connector"),
  scope: CredentialScope,
  credential: ConnectorCredentialSchema,
});

export const sealConnectorCredential = async function (
  scope: z.output<typeof CredentialScope>,
  credential: z.output<typeof ConnectorCredentialSchema>
) {
  const envelope = await Envelope.parseAsync({
    purpose: "tool-connector",
    scope,
    credential,
  }).catch(() => {
    throw new ConnectorError({ reason: "invalid" });
  });
  try {
    const auth = await getAuth();
    return await symmetricEncrypt({
      key: (await auth.$context).secretConfig,
      data: JSON.stringify(envelope),
    });
  } catch {
    throw new ConnectorError({ reason: "unavailable" });
  }
};

export const openConnectorCredential = async function (
  scope: z.output<typeof CredentialScope>,
  kind: z.output<typeof ConnectorCredentialSchema>["kind"],
  data: string
) {
  const plain = await Promise.try(async () => {
    const auth = await getAuth();
    return await symmetricDecrypt({
      key: (await auth.$context).secretConfig,
      data,
    });
  }).catch(() => {
    throw new ConnectorError({ reason: "unavailable" });
  });
  const envelope = await Promise.try(async () =>
    jsonString(Envelope).parseAsync(plain)
  ).catch(() => {
    throw new ConnectorError({ reason: "denied" });
  });
  if (
    envelope.scope.workspaceId !== scope.workspaceId ||
    envelope.scope.id !== scope.id ||
    envelope.scope.revision !== scope.revision ||
    envelope.credential.kind !== kind
  )
    throw new ConnectorError({ reason: "denied" });
  return envelope.credential;
};

/** Remove this connection's credential if a provider echoes it in metadata or output. */
export function redactConnectorCredential(
  serialized: string,
  credential: string
) {
  if (!credential) return serialized;
  const variants = [
    credential,
    encodeURIComponent(credential),
    Buffer.from(credential).toString("base64"),
    Buffer.from(credential).toString("base64url"),
  ];
  for (const variant of new Set(
    variants.toSorted((a, b) => b.length - a.length)
  ))
    serialized = serialized.replaceAll(
      JSON.stringify(variant).slice(1, -1),
      "[redacted]"
    );
  return serialized;
}
