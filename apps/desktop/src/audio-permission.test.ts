import { expect, test } from "vitest";
import { isMicrophoneRequest } from "./audio-permission";
const origin = "https://app.tryzoen.com";
const request = {
  isMainFrame: true,
  requestingUrl: `${origin}/companion`,
  mediaTypes: ["audio" as const],
};
test("only the configured main frame can request microphone access", () => {
  expect(isMicrophoneRequest(request, origin)).toBe(true);
  expect(isMicrophoneRequest({ ...request, isMainFrame: false }, origin)).toBe(
    false
  );
  expect(
    isMicrophoneRequest(
      { ...request, requestingUrl: "https://evil.test" },
      origin
    )
  ).toBe(false);
  expect(
    isMicrophoneRequest(
      { ...request, securityOrigin: "https://evil.test" },
      origin
    )
  ).toBe(false);
  expect(
    isMicrophoneRequest(
      { ...request, requestingUrl: `https://user:secret@app.tryzoen.com` },
      origin
    )
  ).toBe(false);
});
test("camera, mixed, empty and unspecified media requests stay denied", () => {
  for (const mediaTypes of [
    ["video" as const],
    ["audio" as const, "video" as const],
    [],
    undefined,
  ])
    expect(isMicrophoneRequest({ ...request, mediaTypes }, origin)).toBe(false);
});
