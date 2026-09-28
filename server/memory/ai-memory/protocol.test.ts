import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, it, vi } from "vitest";
import { memoryTool } from "./protocol";

describe("private memory protocol", () => {
  it("keeps the note response bound when a separate archive reader opts into a larger bound", async () => {
    const client = new Client({ name: "synthetic-protocol", version: "1" });
    const body = { source: "a".repeat(70_000) };
    const call = vi.spyOn(client, "callTool").mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(body) }],
    });
    await expect(
      memoryTool(
        client,
        "memory_read_session_observations",
        {},
        { maxResultCharacters: 100_000 }
      )
    ).resolves.toEqual(body);
    await expect(memoryTool(client, "memory_read_page", {})).rejects.toThrow(
      /Too big/
    );
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("rejects an unbounded request before contacting the engine", async () => {
    const client = new Client({ name: "synthetic-protocol", version: "1" });
    const call = vi.spyOn(client, "callTool");
    await expect(
      memoryTool(
        client,
        "memory_read_page",
        {},
        { maxResultCharacters: Number.POSITIVE_INFINITY }
      )
    ).rejects.toThrow(/Invalid input/);
    expect(call).not.toHaveBeenCalled();
  });

  it("never forwards a tool error's private payload", async () => {
    const client = new Client({ name: "synthetic-protocol", version: "1" });
    vi.spyOn(client, "callTool").mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Synthetic private provider detail" }],
    });
    await expect(memoryTool(client, "memory_read_page", {})).rejects.toEqual(
      new Error("The private memory operation failed.")
    );
  });

  it("forwards cancellation and rejects ambiguous multiple result blocks", async () => {
    const client = new Client({ name: "synthetic-protocol", version: "1" });
    const call = vi.spyOn(client, "callTool").mockResolvedValue({
      content: [
        { type: "text", text: "{}" },
        { type: "text", text: "{}" },
      ],
    });
    const signal = new AbortController().signal;
    await expect(
      memoryTool(client, "memory_read_page", {}, { signal })
    ).rejects.toThrow(/Too big/);
    expect(call).toHaveBeenCalledWith(
      { name: "memory_read_page", arguments: {} },
      undefined,
      { signal, timeout: 20_000 }
    );
  });
});
