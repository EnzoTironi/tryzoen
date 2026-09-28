import { z } from "zod";

export const referenceSearchSchema = z.object({
  trigger: z.enum(["@", "$", "/"]),
  query: z.string().max(100),
  roomId: z.uuid().optional(),
});
export const composerReferenceSchema = z.object({
  id: z.string(),
  kind: z.enum(["person", "bot", "file", "artifact", "skill", "routine"]),
  title: z.string(),
  detail: z.string(),
  token: z.string(),
});
export const referenceResultsSchema = z.array(composerReferenceSchema).max(24);

/** Match only the token at the caret; email addresses and URLs stay ordinary text. */
export function referenceAt(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)([@$/])([^\s@$/]{0,100})$/u.exec(before);
  if (!match || (match[1] === "$" && /^\d/u.test(match[2] ?? ""))) return null;
  return {
    trigger: referenceSearchSchema.shape.trigger.parse(match[1]),
    query: match[2] ?? "",
    start: caret - (match[2]?.length ?? 0) - 1,
    end: caret,
  };
}

export function insertReference(
  text: string,
  start: number,
  end: number,
  token: string
) {
  const insertion = `${token} `;
  return {
    text: text.slice(0, start) + insertion + text.slice(end),
    caret: start + insertion.length,
  };
}
