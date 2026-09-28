import { getDocumentAsync } from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import type { FileUIPart } from "ai";
import { shareFile } from "./files/share";
import {
  requireAttachmentSizes,
  inlineAttachmentSchema,
} from "@zoen/companion-ui/messages";

export async function pickAttachments(): Promise<FileUIPart[]> {
  const result = await getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  const files = result.assets.map((asset) => ({
    asset,
    file: new File(asset.uri),
  }));
  try {
    requireAttachmentSizes(files.map(({ file }) => file.size));
    const attachments: FileUIPart[] = [];
    for (const { asset, file } of files) {
      const mediaType = asset.mimeType?.length
        ? asset.mimeType
        : "application/octet-stream";
      attachments.push({
        type: "file",
        filename: asset.name.slice(0, 255),
        mediaType,
        url: `data:${mediaType};base64,${await file.base64()}`,
      });
    }
    return attachments;
  } finally {
    for (const { file } of files) {
      if (
        file.uri.startsWith(`${Paths.cache.uri.replace(/\/$/u, "")}/`) &&
        file.exists
      ) {
        try {
          file.delete();
        } catch {
          console.warn("Could not remove a temporary attachment copy.");
        }
      }
    }
  }
}

export async function saveAttachment(file: FileUIPart) {
  const attachment = inlineAttachmentSchema.parse(file);
  await shareFile(attachment.url.slice(attachment.url.indexOf(",") + 1), {
    filename: attachment.filename?.length ? attachment.filename : "attachment",
    mediaType: attachment.mediaType,
    encoding: "base64",
  });
}
