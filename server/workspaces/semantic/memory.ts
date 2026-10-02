import { readFile } from "node:fs/promises";
import { semanticLimits } from "./snapshot";

/** Read-only qualification of this dedicated executor's kernel-enforced boundary. */
export async function verifySemanticMemoryLimit() {
  if (process.platform !== "linux")
    throw new Error(
      "Semantic execution requires a dedicated Linux cgroup v2 runtime"
    );
  const [maximum, swap] = await Promise.all([
    readFile("/sys/fs/cgroup/memory.max", "utf8"),
    readFile("/sys/fs/cgroup/memory.swap.max", "utf8"),
  ]);
  const bytes = Number(maximum.trim());
  if (
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > semanticLimits.memoryBytes ||
    swap.trim() !== "0"
  )
    throw new Error(
      "Semantic executor requires a bounded memory cgroup with swap disabled"
    );
  return bytes;
}
