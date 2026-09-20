import { jsonString } from "@shared/validation";
import { z } from "zod";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@db/services/auth";
import { ConnectorError } from "./definition";

const Envelope = z.object({
  purpose: z.literal("tool-connector"),
  workspaceId: z.string(),
  id: z.string(),
  revision: z.string(),
  value: z.string(),
});

export const sealConnectorCredential = async function (
  workspaceId: string,
  id: string,
  revision: string,
  value: string
) {
  const auth = await getAuth();
  try {
    return await symmetricEncrypt({
      key: (await auth.$context).secretConfig,
      data: JSON.stringify({
        purpose: "tool-connector",
        workspaceId,
        id,
        revision,
        value,
      }),
    });
  } catch {
    throw new ConnectorError({ reason: "unavailable" });
  }
};

export const openConnectorCredential = async function (
  workspaceId: string,
  id: string,
  revision: string,
  data: string
) {
  const auth = await getAuth();
  const plain = await Promise.try(async () =>
    symmetricDecrypt({ key: (await auth.$context).secretConfig, data })
  ).catch(() => {
    throw new ConnectorError({ reason: "unavailable" });
  });
  const envelope = await Promise.try(async () =>
    jsonString(Envelope).parseAsync(plain)
  ).catch(() => {
    throw new ConnectorError({ reason: "denied" });
  });
  if (
    envelope.workspaceId !== workspaceId ||
    envelope.id !== id ||
    envelope.revision !== revision
  )
    throw new ConnectorError({ reason: "denied" });
  return envelope.value;
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
