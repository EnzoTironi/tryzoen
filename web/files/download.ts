export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.replace(/[/\\\p{Cc}]/gu, "-") || "download";
    link.click();
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
}

export async function downloadConversationArchive(
  origin: string,
  sessionId: string,
  space?: string | null
) {
  const url = new URL(
    `/api/conversations/${encodeURIComponent(sessionId)}/archive`,
    origin
  );
  if (space) url.searchParams.set("space", space);
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "No saved conversation archive is available yet. Try again after the conversation has been saved."
        : "Couldn’t export the conversation. Try again."
    );
  }
  downloadBlob(await response.blob(), "zoen-conversation.jsonl");
}

export async function downloadMemoryBackup(
  origin: string,
  space?: string | null
) {
  const url = new URL("/api/workspaces/memory/backup", origin);
  if (space) url.searchParams.set("space", space);
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Couldn’t download your memory backup.");
  downloadBlob(await response.blob(), "zoen-learned-memory.zip");
}
