import { downloadBlob } from "@web/files/download";

export const shareFile: typeof import("./share").shareFile = async (
  content,
  options
) => {
  downloadBlob(
    new Blob(
      [
        options.encoding === "base64"
          ? Uint8Array.from(atob(content), (character) =>
              character.charCodeAt(0)
            )
          : content,
      ],
      { type: options.mediaType }
    ),
    options.filename
  );
};
