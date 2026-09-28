import type { FileUIPart } from "ai";
import {
  requireAttachmentSizes,
  inlineAttachmentSchema,
} from "@zoen/companion-ui/messages";

export function readFileDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("The file could not be read."));
      },
      { once: true }
    );
    reader.addEventListener(
      "error",
      () => {
        reject(new Error("The file could not be read."));
      },
      { once: true }
    );
    reader.addEventListener(
      "abort",
      () => {
        reject(new Error("Reading the file was cancelled."));
      },
      { once: true }
    );
    reader.readAsDataURL(blob);
  });
}

export function pickBrowserAttachments(): Promise<FileUIPart[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve([]);
      },
      { once: true }
    );
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        try {
          requireAttachmentSizes(files.map((file) => file.size));
        } catch (cause) {
          reject(
            cause instanceof Error
              ? cause
              : new Error("The files could not be opened.")
          );
          return;
        }
        void Promise.all(
          files.map(async (file): Promise<FileUIPart> => {
            const mediaType =
              file.type.length > 0 ? file.type : "application/octet-stream";
            return {
              type: "file",
              filename: file.name.slice(0, 255),
              mediaType,
              url: await readFileDataUrl(file.slice(0, file.size, mediaType)),
            };
          })
        ).then(resolve, reject);
      },
      { once: true }
    );
    document.body.append(input);
    input.click();
  });
}

/** Save untrusted files as downloads, never navigate to executable data URLs. */
export async function saveBrowserAttachment(file: FileUIPart) {
  const attachment = inlineAttachmentSchema.parse(file);
  const binary = atob(attachment.url.slice(attachment.url.indexOf(",") + 1));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], { type: attachment.mediaType })
  );
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.filename?.length
      ? attachment.filename.replace(/[/\\\p{Cc}]/gu, "-")
      : "attachment";
    link.click();
  } finally {
    // Leave the object URL alive until the browser has processed the download.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
}
