import { createHash } from "node:crypto";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { creatorExampleSchema } from "@zoen/companion-ui/creators";
import { creatorSourceSchema } from "../sources/schema";

export const corpusPageSchema = z.strictObject({
  path: z.string().regex(/^notes\/[0-9a-f-]{36}\.md$/),
  entryId: z.uuid(),
  attribution: z.string().max(1000),
  rights: creatorExampleSchema.shape.rights.nullable(),
  title: z.string().max(120),
  kind: z.enum(["guidance", "authored", "workspace-source"]),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  offsetUnit: z.literal("utf16"),
  body: z.string().min(1).max(8000),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  source: creatorSourceSchema
    .omit({ snapshot: true })
    .extend({
      snapshot: creatorSourceSchema.shape.snapshot.omit({ content: true }),
    })
    .nullable(),
});
export const corpusManifestSchema = z.strictObject({
  version: z.literal(1),
  releaseId: z.uuid(),
  draftRevision: z.uuid(),
  pages: z.array(corpusPageSchema).max(64),
});
export const corpusAccessSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("creator"), releaseId: z.uuid() }),
  z.strictObject({ kind: z.literal("pilot"), pilotId: z.uuid() }),
]);
export function corpusDigest(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
/** Offsets count UTF-16 code units and never bisect a Unicode scalar. */
export function corpusPages(
  namespace: string,
  entry: Pick<
    z.infer<typeof corpusPageSchema>,
    "entryId" | "title" | "kind" | "source" | "attribution" | "rights"
  >,
  text: string
) {
  const pages: z.infer<typeof corpusPageSchema>[] = [];
  let start = 0;
  let body = "";
  const append = () => {
    if (!body) return;
    pages.push(
      corpusPageSchema.parse({
        ...entry,
        path: `notes/${uuidv5(`${entry.kind}:${entry.entryId}:${start}`, namespace)}.md`,
        start,
        end: start + body.length,
        offsetUnit: "utf16",
        body,
        digest: corpusDigest(body),
      })
    );
    start += body.length;
    body = "";
  };
  for (const character of text) {
    if (body.length + character.length > 8000) append();
    body += character;
  }
  append();
  return pages;
}
