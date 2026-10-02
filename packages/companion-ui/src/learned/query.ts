import { learnedClaimLimits } from "./claim";

export function learnedClaimQueryTerms(text: string) {
  return [
    ...new Set(
      text
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ),
  ];
}

/** Native input may exceed the interactive query bound. Keep the earliest
 * bounded distinct terms. Empty and media-only input stays empty. */
export function normalizeLearnedClaimQuery(text: string) {
  const selected: string[] = [];
  let characters = 0;
  for (const match of text
    .normalize("NFKC")
    .toLowerCase()
    .matchAll(/[\p{L}\p{N}]+/gu)) {
    const term = match[0];
    if (selected.includes(term)) continue;
    const next = characters + term.length + (selected.length ? 1 : 0);
    if (next > learnedClaimLimits.queryCharacters) break;
    selected.push(term);
    characters = next;
    if (selected.length === learnedClaimLimits.queryTerms) break;
  }
  return selected.join(" ");
}
