"use client";
import { useState } from "react";
import type { FileUIPart } from "ai";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";

function BrowserMedia({ file }: { readonly file: FileUIPart }) {
  const [failed, setFailed] = useState(false);
  if (!inlineAttachmentSchema.safeParse(file).success) return null;
  if (failed)
    return (
      <output>
        Este formato não pode ser reproduzido aqui. Salve o arquivo para
        abri-lo.
      </output>
    );
  const label = file.filename ?? "Mídia anexada";
  return file.mediaType.startsWith("video/") ? (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- User-supplied files may not include captions; preserve embedded tracks without inventing transcripts.
    <video
      controls
      playsInline
      preload="metadata"
      src={file.url}
      aria-label={label}
      onError={() => {
        setFailed(true);
      }}
      style={{ width: "100%", maxHeight: 360, display: "block" }}
    />
  ) : (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- User-supplied audio may not include a transcript.
    <audio
      controls
      preload="metadata"
      src={file.url}
      aria-label={label}
      onError={() => {
        setFailed(true);
      }}
      style={{ width: "100%", minWidth: 0, display: "block" }}
    />
  );
}

export function renderBrowserMedia(file: FileUIPart) {
  return <BrowserMedia file={file} />;
}
