import { ChannelMediaError } from "../channels/media/policy";
import { Artifacts } from "./index";
import { decodeMediaText, identifyMedia } from "../channels/media/policy";

export const readArtifactText = async function (
  identityId: string,
  artifactId: string
) {
  const artifacts = Artifacts;
  const stored = await artifacts.read({ identityId, artifactId });
  if (stored.derived)
    return {
      metadata: stored.metadata,
      content: stored.derived,
      untrusted: true as const,
    };
  const decoded = await Promise.try(async () => {
    const mediaType = await identifyMedia(stored.bytes, {
      id: stored.metadata.sourceMediaId,
      mediaType: stored.metadata.mediaType,
      name: stored.metadata.filename,
    });
    if (
      mediaType !== "text/plain" &&
      mediaType !== "text/csv" &&
      mediaType !== "application/json"
    )
      return null;
    const text = await decodeMediaText(stored.bytes);
    await artifacts.setDerived({
      identityId,
      artifactId,
      sha256: stored.metadata.sha256,
      kind: "text",
      text,
    });
    return { kind: "text" as const, text };
  }).catch((error: unknown) => {
    if (error instanceof ChannelMediaError) return Promise.resolve(null);
    throw error;
  });
  return {
    metadata: stored.metadata,
    content: decoded,
    untrusted: true as const,
  };
};
