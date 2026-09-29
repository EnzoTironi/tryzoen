import { expect, test } from "vitest";
import { parseRoomMessageLocation, roomMessageUrl } from "./links";

const location = {
  id: "19cdb11a-2a1e-4f87-9508-cb379b63460c",
  messageId: "$opaque+/=thread:test",
  workspaceId: "team-private",
};

test("message links round-trip an exact event and explicit workspace, without message text", () => {
  const url = new URL(roomMessageUrl("https://app.tryzoen.com", location));
  expect(url.pathname).toBe("/companion");
  expect([...url.searchParams.keys()]).toEqual(["room", "message", "space"]);
  expect(parseRoomMessageLocation(url.searchParams)).toEqual(location);
});

test("rejects malformed and ambiguous references rather than mixing workspaces or messages", () => {
  const params = new URL(roomMessageUrl("https://app.tryzoen.com", location))
    .searchParams;
  params.append("space", "another-workspace");
  expect(parseRoomMessageLocation(params)).toBeUndefined();
  params.delete("space");
  expect(parseRoomMessageLocation(params)).toBeUndefined();
  params.set("space", location.workspaceId);
  params.set("message", "not-a-matrix-event");
  expect(parseRoomMessageLocation(params)).toBeUndefined();
  expect(parseRoomMessageLocation(new URLSearchParams())).toBeUndefined();
});

test("links only use HTTPS or local development and never include credentials", () => {
  for (const origin of [
    "javascript:alert(1)",
    "http://remote.example",
    "https://name:secret@example.com",
  ])
    expect(() => roomMessageUrl(origin, location)).toThrow(
      /Invalid URL|trusted application origin/u
    );
  expect(roomMessageUrl("http://127.0.0.1:3001", location)).toContain(
    "http://127.0.0.1:3001/companion?"
  );
});
