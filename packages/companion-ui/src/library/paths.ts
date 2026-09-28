export function fileTreeRows(
  paths: readonly string[],
  expanded: ReadonlySet<string>,
  query: string,
  descending: boolean
) {
  const nodes = new Map<
    string,
    { id: string; title: string; depth: number; folder: boolean }
  >();
  const search = query.trim().toLowerCase();
  for (const path of paths) {
    if (!path.toLowerCase().includes(search)) continue;
    const parts = path.split("/");
    for (let depth = 0; depth < parts.length; depth++) {
      const folder = depth < parts.length - 1;
      const id = parts.slice(0, depth + 1).join("/") + (folder ? "/" : "");
      nodes.set(id, { id, title: parts[depth] ?? path, depth, folder });
      if (folder && !search && !expanded.has(id)) break;
    }
  }
  // Compare each path segment so children stay directly after their parent,
  // even when the user reverses the sibling ordering.
  // oxlint-disable-next-line unicorn/no-array-sort -- Sort a fresh array while retaining the package’s ES2022 runtime contract.
  return [...nodes.values()].sort((a, b) => {
    const left = a.id.split("/");
    const right = b.id.split("/");
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      const leftName = left[index];
      const rightName = right[index];
      if (leftName === rightName) continue;
      if (!leftName) return -1;
      if (!rightName) return 1;
      const leftFolder = index < left.length - 1;
      const rightFolder = index < right.length - 1;
      if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
      return (descending ? -1 : 1) * leftName.localeCompare(rightName);
    }
    return left.length - right.length;
  });
}
