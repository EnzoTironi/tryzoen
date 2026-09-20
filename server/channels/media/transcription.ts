import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createGateway, transcribe } from "ai";
import { z } from "zod";
import { env } from "@shared/environment/env";
import { jsonString } from "@shared/validation";
import { operationSignal, withTimeout } from "../../operations/async";
import { ChannelTranscriptSchema } from "../../messaging/model";
import { ChannelMediaError, mediaLimits } from "./policy";

const run = promisify(execFile);
const audioType = z.enum(["audio/ogg", "audio/wav"]);
const probeResult = z.object({
  streams: z
    .array(
      z.object({
        codec_type: z.literal("audio"),
        codec_name: z.enum(["opus", "pcm_s16le"]),
        channels: z.number().int().min(1).max(2),
      })
    )
    .length(1),
  format: z.object({ duration: z.coerce.number().gt(0) }),
});

export async function validateAudioDuration(
  bytes: Uint8Array,
  mediaType: z.output<typeof audioType>
) {
  if (bytes.length > mediaLimits.audioBytes)
    throw new ChannelMediaError({ reason: "too_large" });
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "zoen-audio-"));
    const path = join(directory, "audio");
    await writeFile(path, bytes, { mode: 0o600 });
    const { stdout } = await run(
      env.COMPANION_FFPROBE_PATH,
      [
        "-v",
        "error",
        "-max_alloc",
        "67108864",
        "-probesize",
        String(mediaLimits.audioBytes),
        "-analyzeduration",
        "2000000",
        "-protocol_whitelist",
        "file",
        "-f",
        audioType.parse(mediaType) === "audio/ogg" ? "ogg" : "wav",
        "-i",
        path,
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,channels",
        "-of",
        "json",
      ],
      {
        env: { NODE_ENV: "production", PATH: env.PATH ?? "" },
        timeout: 5_000,
        killSignal: "SIGKILL",
        maxBuffer: 8192,
        signal: operationSignal(),
      }
    );
    const probe = jsonString(probeResult).parse(stdout);
    if (probe.format.duration > mediaLimits.audioSeconds)
      throw new ChannelMediaError({ reason: "duration_limit" });
    return probe.format.duration;
  } catch (error) {
    if (error instanceof ChannelMediaError) throw error;
    const unavailable =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    throw new ChannelMediaError({
      reason: unavailable ? "transcription_unavailable" : "invalid_media",
    });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export async function transcribeChannelAudio(
  bytes: Uint8Array,
  mediaType: z.output<typeof audioType>
) {
  const model = env.COMPANION_TRANSCRIPTION_MODEL;
  const key = env.AI_GATEWAY_API_KEY;
  if (!model || !key)
    throw new ChannelMediaError({ reason: "transcription_unavailable" });
  await validateAudioDuration(bytes, mediaType);
  try {
    return await withTimeout(async () => {
      const result = await transcribe({
        model: createGateway({ apiKey: key.reveal() }).transcriptionModel(
          model
        ),
        audio: bytes,
        abortSignal: operationSignal(),
        maxRetries: 0,
      });
      return ChannelTranscriptSchema.parse(result.text.trim());
    }, 40_000);
  } catch {
    throw new ChannelMediaError({ reason: "transcription_failed" });
  }
}
