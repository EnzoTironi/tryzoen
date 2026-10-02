import {
  PrivateMemoryArchivePreviewSchema,
  PrivateMemoryArchiveRestoreResultSchema,
  privateMemoryArchiveDownloads,
  privateMemoryArchiveLimits,
} from "@zoen/companion-ui/memory";
import type { MemoryArchiveReview } from "@zoen/companion-ui";

function chooseArchive() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.zoen-memory,${privateMemoryArchiveDownloads["complete-journal"].contentType}`;
    input.hidden = true;
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener(
      "change",
      () => {
        finish(input.files?.[0] ?? null);
      },
      {
        once: true,
      }
    );
    input.addEventListener(
      "cancel",
      () => {
        finish(null);
      },
      { once: true }
    );
    document.body.append(input);
    input.click();
  });
}

/** A File is immutable; both requests send the exact held inspected object. */
export async function inspectMemoryArchiveFile(
  origin: string,
  file: File,
  space?: string | null
): Promise<MemoryArchiveReview> {
  if (!file.size || file.size > privateMemoryArchiveLimits.wireBytes)
    throw new Error(
      "Choose a nonempty private-memory archive within the archive size limit."
    );
  if (/\.zip$/iu.test(file.name))
    throw new Error(
      "Legacy ZIP memory backups cannot be restored as canonical private-memory archives."
    );
  const digest = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const url = new URL("/api/workspaces/memory/restore", origin);
  if (space) url.searchParams.set("space", space);
  url.searchParams.set("mode", "inspect");
  let held: File | undefined = file;
  const send = async (target: URL): Promise<unknown> => {
    if (!held)
      throw new Error(
        "Choose and inspect the archive again before applying it."
      );
    const response = await fetch(target, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type":
          privateMemoryArchiveDownloads["complete-journal"].contentType,
      },
      body: held,
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
  if (preview.archiveDigest !== digest)
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
      held = undefined;
    },
  };
}

export async function chooseMemoryArchive(
  origin: string,
  space?: string | null
) {
  const file = await chooseArchive();
  return file ? inspectMemoryArchiveFile(origin, file, space) : null;
}
