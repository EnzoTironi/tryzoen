import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { getDocumentAsync } from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { fetch } from "expo/fetch";
import {
  PrivateMemoryArchivePreviewSchema,
  PrivateMemoryArchiveRestoreResultSchema,
  privateMemoryArchiveDownloads,
  privateMemoryArchiveLimits,
} from "@zoen/companion-ui/memory";
import type { MemoryArchiveReview } from "@zoen/companion-ui";
import { sharePrivateArchive } from "./archive.native";
import { apiOrigin } from "../environment";
import { accountHeaders } from "../auth";

const archive = privateMemoryArchiveDownloads["complete-journal"];
export const exportMemory = () =>
  sharePrivateArchive({
    path: "/api/workspaces/memory/backup?coverage=complete-journal",
    filename: archive.filename,
    mimeType: archive.contentType,
    title: "Save complete private-memory archive",
  });

export async function inspectMemory(): Promise<MemoryArchiveReview | null> {
  const selected = await getDocumentAsync({
    type: "*/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (selected.canceled) return null;
  const asset = selected.assets[0];
  if (!asset) throw new Error("Choose a private-memory archive.");
  const file = new File(asset.uri);
  if (!file.uri.startsWith(Paths.cache.uri.replace(/\/?$/u, "/")))
    throw new Error(
      "The selected archive must be copied to private app cache before inspection."
    );
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (!file.size || file.size > privateMemoryArchiveLimits.wireBytes)
      throw new Error(
        "Choose a nonempty archive within the archive size limit."
      );
    if (/\.zip$/iu.test(asset.name))
      throw new Error(
        "Legacy ZIP memory backups cannot be restored as canonical private-memory archives."
      );
    bytes = await file.bytes();
    if (
      !bytes.byteLength ||
      bytes.byteLength > privateMemoryArchiveLimits.wireBytes
    )
      throw new Error("The selected archive exceeds its size limit.");
  } finally {
    if (file.exists) file.delete();
  }
  const archiveDigest = [
    ...new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const url = new URL("/api/workspaces/memory/restore?mode=inspect", apiOrigin);
  const send = async (target: URL): Promise<unknown> => {
    if (!bytes)
      throw new Error(
        "Choose and inspect the archive again before applying it."
      );
    const response = await fetch(target, {
      method: "POST",
      headers: {
        ...(await accountHeaders()),
        "content-type": archive.contentType,
      },
      body: bytes,
    });
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? "This archive conflicts with current memory. Review the archive and current head before inspecting again."
          : response.status === 401 || response.status === 403
            ? "Current account access does not permit this memory archive."
            : "The private-memory archive could not be validated or applied."
      );
    return response.json();
  };
  const preview = PrivateMemoryArchivePreviewSchema.parse(await send(url));
  if (preview.archiveDigest !== archiveDigest)
    throw new Error(
      "The inspected archive hash does not match the selected file."
    );
  return {
    preview,
    async apply() {
      const apply = new URL(url);
      apply.searchParams.set("mode", "apply");
      apply.searchParams.set(
        "expectedRevision",
        preview.expectedRevision ?? ""
      );
      apply.searchParams.set("archiveDigest", preview.archiveDigest);
      return PrivateMemoryArchiveRestoreResultSchema.parse(await send(apply));
    },
    async dispose() {
      bytes = undefined;
    },
  };
}
