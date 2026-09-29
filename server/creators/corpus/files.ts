import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { link, open, rm } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import type { corpusManifestSchema } from "./schema";

/** A separate private manifest binds the readable native pages to the approved release. */
export async function verifyCorpusManifest(
  directory: string,
  manifest: z.infer<typeof corpusManifestSchema>,
  initialized: boolean
) {
  const path = join(directory, "release-manifest.json");
  const expected = JSON.stringify(manifest);
  if (!initialized) {
    const temporary = join(directory, `.release-manifest-${randomUUID()}.tmp`);
    try {
      await using file = await open(temporary, "wx", 0o600);
      await file.writeFile(expected);
      await file.sync();
      try {
        await link(temporary, path);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST"
        )
          throw error;
      }
      await using parent = await open(directory, "r");
      await parent.sync();
    } finally {
      await rm(temporary, { force: true });
    }
  }
  await using file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  const stat = await file.stat();
  if (!stat.isFile() || stat.size > 262144 || (stat.mode & 0o077) !== 0)
    throw new Error("Invalid creator corpus manifest file.");
  if ((await file.readFile("utf8")) !== expected)
    throw new Error(
      "Creator corpus manifest does not match the approved release."
    );
}
