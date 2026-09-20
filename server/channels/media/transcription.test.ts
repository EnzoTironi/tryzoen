import { expect, it } from "vitest";
import { transcribeChannelAudio } from "./transcription";

it("fails the unavailable transcription profile without a provider call", async () => {
  await expect(
    transcribeChannelAudio(
      Buffer.from("unused because the profile is absent"),
      "audio/wav"
    )
  ).rejects.toMatchObject({ reason: "transcription_unavailable" });
});
