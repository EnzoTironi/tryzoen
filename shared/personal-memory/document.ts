export class PersonalNoteInvalid extends Error {}

// Eve 0.63 file-memory's persisted v1 contract. Keep indices permanent across
// human edits so a concurrent agent cannot remove a different fact by old index.
export function readPersonalNote(content: string) {
  const header =
    /^<!-- eve-memory-file-v1 lastAllocatedIndex=(-1|0|[1-9]\d*) -->\n/u.exec(
      content
    );
  if (!header)
    throw new PersonalNoteInvalid("This note format cannot be edited here.");
  const lastIndex = Number(header[1]);
  if (!Number.isSafeInteger(lastIndex))
    throw new PersonalNoteInvalid("Invalid memory index.");
  const body = content.slice(header[0].length);
  if (body && !body.endsWith("\n"))
    throw new PersonalNoteInvalid("Invalid memory document.");
  const indices = new Set<number>();
  const entries = body
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+): (.+)$/u.exec(line);
      const index = Number(match?.[1]);
      const text = match?.[2];
      if (
        !text ||
        !Number.isSafeInteger(index) ||
        index > lastIndex ||
        indices.has(index)
      )
        throw new PersonalNoteInvalid("Invalid memory entry.");
      indices.add(index);
      return { index, text };
    });
  return { entries, lastIndex };
}

export function personalNoteText(content: string) {
  return readPersonalNote(content)
    .entries.map((entry) => entry.text)
    .join("\n");
}

export function replacePersonalNoteText(previous: string, text: string) {
  const document = readPersonalNote(previous);
  let lastIndex = document.lastIndex;
  const lines = [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.replaceAll(/\s+/gu, " ").trim())
        .filter(Boolean)
    ),
  ];
  const entries = lines
    .map((line) => {
      if (new TextEncoder().encode(line).length > 2048)
        throw new PersonalNoteInvalid(
          "Keep each note under 2,048 bytes. Put separate facts on separate lines."
        );
      const existing = document.entries.find((entry) => entry.text === line);
      const index = existing?.index ?? ++lastIndex;
      if (!Number.isSafeInteger(index))
        throw new PersonalNoteInvalid(
          "This memory has reached its entry limit."
        );
      return { index, text: line };
    })
    // oxlint-disable-next-line unicorn/no-array-sort -- This new local array also runs on the native ES2022 target.
    .sort((a, b) => a.index - b.index);
  const body = entries
    .map((entry) => `${entry.index}: ${entry.text}`)
    .join("\n");
  // Reserve the native recall heading/removal instructions within its 4,000-char budget.
  if (body.length > 3600)
    throw new PersonalNoteInvalid(
      "These notes are too long. Shorten them before saving."
    );
  return `<!-- eve-memory-file-v1 lastAllocatedIndex=${lastIndex} -->\n${body ? `${body}\n` : ""}`;
}
