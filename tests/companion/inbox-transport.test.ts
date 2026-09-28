import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import { expect, it, vi } from "vitest";
import { companionInboxData } from "../../shared/companion/inbox";

it.each(["list", "sync"] as const)(
  "cancels the actual %s transport when its foreground owner stops",
  async (operation) => {
    const transport = vi.fn<typeof fetch>(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          if (!signal) throw new Error("Missing transport cancellation");
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("Transport aborted"));
            },
            { once: true }
          );
        })
    );
    const rpc = createTRPCUntypedClient({
      links: [httpLink({ url: "http://localhost/api/trpc", fetch: transport })],
    });
    const inbox = companionInboxData(rpc);
    const controller = new AbortController();
    const result = inbox[operation]({}, controller.signal);
    await vi.waitFor(() => {
      expect(transport).toHaveBeenCalledOnce();
    });
    controller.abort();
    await expect(result).rejects.toThrow(/abort/i);
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  }
);
