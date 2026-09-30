import type { FileUIPart } from "ai";
import { downloadBlob } from "./download";
import {
  requireAttachmentSizes,
  inlineAttachmentSchema,
} from "@zoen/companion-ui/messages";

interface LocalFileReadOptions {
  readonly signal?: AbortSignal;
  /** Bytes read from local files; this never represents network upload progress. */
  readonly onLocalReadProgress?: (loaded: number, total: number) => void;
}

export function readFileDataUrl(
  blob: Blob,
  { signal, onLocalReadProgress }: LocalFileReadOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Reading the file was cancelled.", {
              cause: signal.reason,
            })
      );
      return;
    }
    const reader = new FileReader();
    let settled = false;
    let loaded = 0;
    const cleanup = () => {
      reader.removeEventListener("load", onLoad);
      reader.removeEventListener("error", onError);
      reader.removeEventListener("abort", onAbort);
      reader.removeEventListener("progress", onProgress);
      signal?.removeEventListener("abort", onCancellation);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (reader.readyState === FileReader.LOADING) reader.abort();
      reject(
        cause instanceof Error
          ? cause
          : new Error("The file could not be read.", { cause })
      );
    };
    const reportProgress = (bytes: number) => {
      loaded = Math.max(loaded, Math.min(blob.size, bytes));
      onLocalReadProgress?.(loaded, blob.size);
    };
    function onLoad() {
      if (typeof reader.result !== "string") {
        fail(new Error("The file could not be read."));
        return;
      }
      try {
        reportProgress(blob.size);
      } catch (cause) {
        fail(cause);
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      resolve(reader.result);
    }
    function onError() {
      fail(new Error("The file could not be read."));
    }
    function onAbort() {
      fail(new Error("Reading the file was cancelled."));
    }
    function onCancellation() {
      fail(signal?.reason);
    }
    function onProgress(event: ProgressEvent<FileReader>) {
      if (!Number.isFinite(event.loaded) || event.loaded < 0) return;
      try {
        reportProgress(event.loaded);
      } catch (cause) {
        fail(cause);
      }
    }
    reader.addEventListener("load", onLoad);
    reader.addEventListener("error", onError);
    reader.addEventListener("abort", onAbort);
    reader.addEventListener("progress", onProgress);
    signal?.addEventListener("abort", onCancellation, { once: true });
    try {
      if (signal?.aborted) onCancellation();
      else reader.readAsDataURL(blob);
    } catch (cause) {
      fail(cause);
    }
  });
}

export function pickBrowserAttachments(
  options: LocalFileReadOptions = {}
): Promise<FileUIPart[]> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(
        options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error("Reading the files was cancelled.", {
              cause: options.signal.reason,
            })
      );
      return;
    }
    const input = document.createElement("input");
    const controller = new AbortController();
    let settled = false;
    let removed = false;
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    const removeChooser = () => {
      input.removeEventListener("cancel", onCancel);
      input.removeEventListener("change", onChange);
      if (!removed) {
        removed = true;
        input.remove();
      }
    };
    const cleanup = () => {
      removeChooser();
      options.signal?.removeEventListener("abort", onCancellation);
    };
    const finish = (files: FileUIPart[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort(cause);
      reject(
        cause instanceof Error
          ? cause
          : new Error("The files could not be opened.", { cause })
      );
    };
    function onCancel() {
      finish([]);
    }
    function onCancellation() {
      fail(options.signal?.reason);
    }
    function onChange() {
      const files = Array.from(input.files ?? []);
      removeChooser();
      try {
        requireAttachmentSizes(files.map((file) => file.size));
        const loaded = files.map(() => 0);
        const total = files.reduce((sum, file) => sum + file.size, 0);
        void Promise.all(
          files.map(async (file, index): Promise<FileUIPart> => {
            const mediaType =
              file.type.length > 0 ? file.type : "application/octet-stream";
            const url = await readFileDataUrl(
              file.slice(0, file.size, mediaType),
              {
                signal: controller.signal,
                onLocalReadProgress(bytes) {
                  loaded[index] = bytes;
                  options.onLocalReadProgress?.(
                    loaded.reduce((sum, bytesRead) => sum + bytesRead, 0),
                    total
                  );
                },
              }
            );
            return {
              type: "file",
              filename: file.name.slice(0, 255),
              mediaType,
              url,
            };
          })
        ).then(finish, fail);
      } catch (cause) {
        fail(cause);
      }
    }
    input.addEventListener("cancel", onCancel);
    input.addEventListener("change", onChange);
    options.signal?.addEventListener("abort", onCancellation, { once: true });
    try {
      if (options.signal?.aborted) onCancellation();
      else {
        document.body.append(input);
        input.click();
      }
    } catch (cause) {
      fail(cause);
    }
  });
}

/** Save untrusted files as downloads, never navigate to executable data URLs. */
export async function saveBrowserAttachment(file: FileUIPart) {
  const attachment = inlineAttachmentSchema.parse(file);
  const binary = atob(attachment.url.slice(attachment.url.indexOf(",") + 1));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  downloadBlob(
    new Blob([bytes], { type: attachment.mediaType }),
    attachment.filename?.length ? attachment.filename : "attachment"
  );
}
