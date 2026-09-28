import { find } from "linkifyjs";
import { isSafeWebLink } from "../links";
/** A message can render at most two deduplicated previews. Code stays code. */
export function messageLinks(text: string) {
  const prose = text.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/gu, "");
  return [
    ...new Set(
      find(prose)
        .filter(
          (link) =>
            link.type === "url" &&
            /^https?:\/\//u.test(link.value) &&
            isSafeWebLink(link.href)
        )
        .map((link) => link.href)
    ),
  ].slice(0, 2);
}
