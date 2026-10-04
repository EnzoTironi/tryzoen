import type { AccessScope } from "@shared/identity/access-scope";
import { readReadyBrowserImageArtifact } from "@db/services/browser-images";
import { maximumWorkerCompletionImages } from "@agent/subagents/browser-agent/lib/completion";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "./markdown";
interface LinqImageArtifactFile {
  readonly data: Buffer;
  readonly filename: string;
  readonly mimeType: string;
}
export async function prepareLinqImageArtifactDelivery(
  message: string,
  input: {
    readonly rootSessionId: string;
    readonly scope: AccessScope;
    readonly signal?: AbortSignal;
  }
) {
  const references = extractImageArtifactMarkdownReferences(message);
  if (references.length === 0) {
    return {
      failedArtifactIds: [],
      files: [],
      text: message,
    };
  }
  const selected = references.slice(0, maximumWorkerCompletionImages);
  const loaded = await Promise.all(
    selected.map(async (reference) => ({
      image: await readReadyBrowserImageArtifact(input.scope, reference.id, {
        rootSessionId: input.rootSessionId,
        signal: input.signal,
      }).catch(() => undefined),
      reference,
    }))
  );
  const failedArtifactIds = [
    ...loaded
      .filter((item) => item.image === undefined)
      .map((item) => item.reference.id),
    ...references
      .slice(maximumWorkerCompletionImages)
      .map((reference) => reference.id),
  ];
  const files = loaded.flatMap(({ image }) =>
    image
      ? [
          {
            data: Buffer.from(image.bytes),
            filename: image.filename,
            mimeType: image.mediaType,
          } satisfies LinqImageArtifactFile,
        ]
      : []
  );
  return {
    failedArtifactIds,
    files,
    text: stripImageArtifactMarkdownReferences(message),
  };
}
