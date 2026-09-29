import { Client, type MessageStreamEvent } from "eve/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readLatestSessionHistory,
  readOlderSessionHistory,
} from "../../packages/companion-ui/src/session/history";

describe("session history", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a bounded tail and keeps only the latest four message turns", async () => {
    const events = Array.from({ length: 6 }, (_, index) =>
      receivedMessage(index)
    );
    const fetchMock = vi.fn<() => Promise<Response>>(() =>
      Promise.resolve(
        new Response(events.map((event) => JSON.stringify(event)).join("\n"), {
          headers: { "x-eve-stream-tail-index": "5" },
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const history = await readLatestSessionHistory(
      new Client({ host: "", redirect: "error" }),
      "session/one"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/eve/v1/session/session%2Fone/stream?startIndex=-128&includeTailIndex=1",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(history).toEqual({
      endIndex: 6,
      events: events.slice(2),
      startIndex: 2,
    });
  });

  it("rejects a stream response without a durable tail cursor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<() => Promise<Response>>(() => Promise.resolve(new Response("\n")))
    );

    await expect(
      readLatestSessionHistory(
        new Client({ host: "", redirect: "error" }),
        "missing-tail"
      )
    ).rejects.toThrow("valid tail index");
  });
});

function receivedMessage(index: number): MessageStreamEvent {
  return {
    data: {
      message: `Message ${String(index)}`,
      sequence: index,
      turnId: `turn_${String(index)}`,
    },
    meta: {
      at: new Date(index * 1000).toISOString(),
      id: `event_${String(index)}`,
    },
    type: "message.received",
  };
}

it("caps a history page at eight chunks when a long turn has no message boundary", async () => {
  const fetchMock = vi.fn<() => Promise<Response>>(() =>
    Promise.resolve(
      new Response(
        Array.from({ length: 128 }, (_, index) =>
          JSON.stringify({
            type: "session.waiting",
            data: { continuationToken: "", wait: "next-user-message" },
            meta: { id: `event-${index}`, at: "2026-09-28T00:00:00Z" },
          })
        ).join("\n"),
        {
          headers: {
            "content-type": "application/x-ndjson",
            "x-eve-stream-version": "25",
            "x-eve-stream-tail-index": "4095",
          },
        }
      )
    )
  );
  vi.stubGlobal("fetch", fetchMock);
  try {
    const history = await readOlderSessionHistory(
      new Client({ host: "" }),
      "large",
      4096
    );
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(history.startIndex).toBe(3072);
    expect(history.events).toHaveLength(1024);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("does not read a history chunk after cancellation", async () => {
  const fetchMock = vi.fn<() => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  controller.abort();
  try {
    await expect(
      readOlderSessionHistory(
        new Client({ host: "" }),
        "large",
        4096,
        controller.signal
      )
    ).rejects.toThrow(/abort/i);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
