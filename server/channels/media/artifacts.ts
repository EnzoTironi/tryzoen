import { ProviderInputError } from "../provider-errors";
import type { Identity } from "../../accounts";
import { Artifacts } from "../../artifacts";
import type { MessagePayload } from "../../messaging/model";
import { Telegram } from "../telegram";
import { Kapso } from "../kapso";
import { ChannelTransport } from "../transport";
import { ChannelMediaError, mediaLimits } from "./policy";

export const loadChannelArtifacts = async function (
  identity: Identity,
  payload: MessagePayload,
  sourceInboxId: string
) {
  const artifacts = Artifacts;
  const transport = ChannelTransport;
  const stored: Awaited<ReturnType<(typeof Artifacts)["read"]>>[] = [];
  let remaining = mediaLimits.totalBytes;
  for (const reference of payload.attachments ?? []) {
    await transport.activeIdentity(identity.id, identity.channel);
    const source = {
      identityId: identity.id,
      sourceInboxId,
      mediaId: reference.id,
    };
    let artifact = await artifacts.readForSource(source);
    if (!artifact) {
      const provider = identity.channel === "telegram" ? Telegram : Kapso;
      const bytes = await Promise.try(async () =>
        provider.downloadMedia(identity.installationId, reference.id, remaining)
      ).catch((error: unknown) => {
        if (error instanceof ProviderInputError)
          return (() => {
            throw new ChannelMediaError({ reason: "download_failed" });
          })();
        throw error;
      });
      const saved = await artifacts.put({ ...source, bytes });
      artifact = await artifacts.read({
        identityId: identity.id,
        artifactId: saved.artifactId,
      });
    }
    remaining -= artifact.bytes.byteLength;
    if (remaining < 0) throw new ChannelMediaError({ reason: "too_large" });
    stored.push(artifact);
  }
  return stored;
};
