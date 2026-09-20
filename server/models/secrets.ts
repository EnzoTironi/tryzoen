import { jsonString } from "@shared/validation";
import { z } from "zod";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@db/services/auth";
import {
  ModelConnectionError,
  ModelProviderSchema,
} from "../../shared/models/catalog";

const Envelope = z.object({
  workspaceId: z.string(),
  provider: ModelProviderSchema,
  value: z.string(),
});

export const sealModelSecret = async function (
  workspaceId: string,
  provider: z.output<typeof ModelProviderSchema>,
  value: string
) {
  const auth = await getAuth();
  try {
    return await symmetricEncrypt({
      key: (await auth.$context).secretConfig,
      data: JSON.stringify({ workspaceId, provider, value }),
    });
  } catch {
    throw new ModelConnectionError({ reason: "unavailable" });
  }
};

export const openModelSecret = async function (
  workspaceId: string,
  provider: z.output<typeof ModelProviderSchema>,
  data: string
) {
  const auth = await getAuth();
  const plain = await Promise.try(async () =>
    symmetricDecrypt({ key: (await auth.$context).secretConfig, data })
  ).catch(() => {
    throw new ModelConnectionError({ reason: "reconnect" });
  });
  const envelope = await Promise.try(async () =>
    jsonString(Envelope).parseAsync(plain)
  ).catch(() => {
    throw new ModelConnectionError({ reason: "reconnect" });
  });
  if (envelope.workspaceId !== workspaceId || envelope.provider !== provider)
    throw new ModelConnectionError({ reason: "reconnect" });
  return envelope.value;
};
