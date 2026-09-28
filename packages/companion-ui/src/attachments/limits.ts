/** Inline Eve input stays below the hosted request limit after base64 encoding. */
export const attachmentLimits = { count: 4, bytes: 3 * 1024 * 1024 } as const;

export function inlineAttachmentBytes(url: string) {
  const length = url.length - url.indexOf(",") - 1;
  return (
    (length / 4) * 3 - (url.endsWith("==") ? 2 : url.endsWith("=") ? 1 : 0)
  );
}

export function requireAttachmentSizes(sizes: readonly number[]) {
  if (
    sizes.length > attachmentLimits.count ||
    sizes.some((size) => !Number.isSafeInteger(size) || size < 0) ||
    sizes.reduce((total, size) => total + size, 0) > attachmentLimits.bytes
  ) {
    throw new Error("Choose up to four files totaling 3 MiB.");
  }
}
