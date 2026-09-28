import { getSchema, type JSONContent } from "@tiptap/core";
import { Transform } from "@tiptap/pm/transform";
import { StarterKit } from "@tiptap/starter-kit";
import type { z } from "zod";
import { documentMarkdown } from "../editor/markdown";
import {
  referenceAt,
  type composerReferenceSchema,
} from "../references/schema";

export { isSafeWebLink } from "../links";

export const composerExtensions = [
  StarterKit.configure({
    link: {
      openOnClick: false,
      autolink: false,
      protocols: ["zoen-reference"],
    },
    underline: false,
  }),
];
const schema = getSchema(composerExtensions);
export function composerReferenceAt(content: JSONContent, position: number) {
  const doc = schema.nodeFromJSON(content);
  const resolved = doc.resolve(Math.min(position, doc.content.size));
  if (
    resolved
      .marks()
      .some(
        (mark) =>
          mark.type.name === "link" &&
          String(mark.attrs.href).startsWith("zoen-reference:")
      )
  )
    return null;
  const before = resolved.parent.textBetween(
    0,
    resolved.parentOffset,
    "",
    "\n"
  );
  const token = referenceAt(before, before.length);
  return token
    ? { ...token, start: position - (token.end - token.start), end: position }
    : null;
}
export function composerReferenceContent(
  item: z.infer<typeof composerReferenceSchema>
): JSONContent[] {
  return [
    {
      type: "text",
      text: item.title,
      marks: [
        {
          type: "link",
          attrs: {
            href: `zoen-reference:/${item.kind}/${encodeURIComponent(item.token)}`,
          },
        },
      ],
    },
    { type: "text", text: " " },
  ];
}
export function replaceComposerRange(
  content: JSONContent,
  from: number,
  to: number,
  insertion: JSONContent[]
) {
  const doc = schema.nodeFromJSON(content);
  const nodes = insertion.map((node) => schema.nodeFromJSON(node));
  const result: unknown = new Transform(doc)
    .replaceWith(from, to, nodes)
    .doc.toJSON();
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Invalid editor document");
  return result;
}
export function composerMarkdown(content: JSONContent): string {
  return documentMarkdown.serialize(serializeReference(content));
}

function serializeReference(node: JSONContent): JSONContent {
  const reference = node.marks?.find(
    (mark) =>
      mark.type === "link" &&
      typeof mark.attrs?.href === "string" &&
      mark.attrs.href.startsWith("zoen-reference:/")
  );
  if (reference) {
    const href = String(reference.attrs?.href);
    const match =
      /^zoen-reference:\/(?:person|bot|file|artifact|skill|routine)\/(.+)$/u.exec(
        href
      );
    let token = node.text ?? "";
    if (match?.[1]) {
      try {
        token = decodeURIComponent(match[1]);
      } catch {
        /* Keep pasted malformed references as their visible text. */
      }
    }
    return {
      ...node,
      text: token,
      marks: node.marks?.filter((mark) => mark !== reference),
    };
  }
  if (!node.content) return node;
  const content: JSONContent[] = [];
  for (const child of node.content.map(serializeReference)) {
    const previous = content.at(-1);
    if (
      previous?.type === "text" &&
      child.type === "text" &&
      JSON.stringify(previous.marks ?? []) === JSON.stringify(child.marks ?? [])
    )
      previous.text = (previous.text ?? "") + (child.text ?? "");
    else content.push(child);
  }
  return { ...node, content };
}
