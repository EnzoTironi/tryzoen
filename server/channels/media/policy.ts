import { isValid } from "@shared/validation";
import { z } from "zod";
import { artifactLimits } from "../../artifacts/model";
import type { MessagePayload } from "../../messaging/model";
import { sniffBrowserImageMediaType } from "../../../shared/browser/artifact";

export type MediaReference = NonNullable<MessagePayload["attachments"]>[number];

export const mediaLimits = {
  attachments: 3,
  totalBytes: artifactLimits.bytes,
  imageBytes: 3 * 1024 * 1024,
  textBytes: artifactLimits.textBytes,
  audioBytes: 3 * 1024 * 1024,
  audioSeconds: 120,
} as const;

export class ChannelMediaError extends Error {
  readonly _tag = "ChannelMediaError";
  declare readonly reason:
    | "unsupported_type"
    | "model_input_unavailable"
    | "too_large"
    | "invalid_media"
    | "download_failed"
    | "wrong_installation"
    | "transcription_unavailable"
    | "transcription_failed"
    | "duration_limit";
  constructor(input: {
    readonly reason:
      | "unsupported_type"
      | "model_input_unavailable"
      | "too_large"
      | "invalid_media"
      | "download_failed"
      | "wrong_installation"
      | "transcription_unavailable"
      | "transcription_failed"
      | "duration_limit";
  }) {
    super("ChannelMediaError");
    this.name = "ChannelMediaError";
    Object.assign(this, input);
  }
}

export function mediaFailureMessage(error: ChannelMediaError) {
  switch (error.reason) {
    case "too_large":
      return "This attachment is too large. Send up to three files totaling 10 MiB; images and audio must each be at most 3 MiB, and text files 64 KiB.";
    case "duration_limit":
      return "Please send a voice note no longer than two minutes, or send the information as text.";
    case "transcription_unavailable":
      return "Voice transcription is unavailable on this installation. Please send the information as text.";
    case "model_input_unavailable":
      return "Image and PDF reading is unavailable with the current model. Please send a UTF-8 text file or paste the information as text.";
    case "unsupported_type":
      return "I can read UTF-8 text files. Voice supports Ogg/Opus or 16-bit PCM WAV when transcription is configured. Please send a supported file or paste the information as text.";
    default:
      return "I couldn’t read this attachment. Please resend it or send the information as text.";
  }
}

const textType = z.enum(["text/plain", "text/csv", "application/json"]);

export const identifyMedia = async function (
  bytes: Uint8Array,
  reference: MediaReference
) {
  if (bytes.length === 0)
    throw new ChannelMediaError({ reason: "invalid_media" });
  const head = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.length, 64)
  );
  const claimed = reference.mediaType.split(";")[0]?.trim().toLowerCase();
  const imageType = sniffBrowserImageMediaType(bytes);
  const mediaType =
    imageType === "image/png" || imageType === "image/jpeg"
      ? imageType
      : head.subarray(0, 5).toString("ascii") === "%PDF-"
        ? "application/pdf"
        : head.subarray(0, 4).toString("ascii") === "OggS"
          ? "audio/ogg"
          : head.subarray(0, 4).toString("ascii") === "RIFF" &&
              head.subarray(8, 12).toString("ascii") === "WAVE"
            ? "audio/wav"
            : isValid(textType, claimed)
              ? claimed
              : undefined;
  if (!mediaType) throw new ChannelMediaError({ reason: "unsupported_type" });
  const allowedClaim =
    claimed === "application/octet-stream" ||
    claimed === mediaType ||
    (mediaType === "audio/ogg" && claimed === "application/ogg") ||
    (mediaType === "audio/wav" && claimed === "audio/x-wav");
  if (!allowedClaim) throw new ChannelMediaError({ reason: "invalid_media" });
  const limit = mediaType.startsWith("image/")
    ? mediaLimits.imageBytes
    : mediaType.startsWith("audio/")
      ? mediaLimits.audioBytes
      : isValid(textType, mediaType)
        ? mediaLimits.textBytes
        : mediaLimits.totalBytes;
  if (bytes.length > limit)
    throw new ChannelMediaError({ reason: "too_large" });
  return mediaType;
};

export const decodeMediaText = async function (bytes: Uint8Array) {
  const text = await Promise.try(async () =>
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  ).catch(() => {
    throw new ChannelMediaError({ reason: "invalid_media" });
  });
  try {
    return await z
      .string()
      .min(1)
      .refine((value) =>
        value.split("").every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 || code === 9 || code === 10 || code === 13;
        })
      )
      .parseAsync(text);
  } catch {
    throw new ChannelMediaError({ reason: "invalid_media" });
  }
};

/** No current model resolver exposes verified binary input capabilities.
 * Spark and the configured free model are text-only; unknown models fail closed.
 */
export const requireChannelModelInput = async function (mediaType: string) {
  if (mediaType.startsWith("image/") || mediaType === "application/pdf")
    await Promise.reject(
      new ChannelMediaError({
        reason: "model_input_unavailable",
      })
    );
};
