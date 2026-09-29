import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import { expect, it, vi } from "vitest";
import { companionVaultData } from "../../shared/companion/vault";

it("uses a cancellable POST for explicit secret reads, keeping the item out of request URLs", async () => {
  const transport = vi.fn<typeof fetch>(
    (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = options?.signal;
        if (!signal) throw Error("Missing cancellation");
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
  const vault = companionVaultData(rpc);
  const controller = new AbortController();
  const result = vault.read(
    { id: "synthetic-item", updatedAt: "2026-01-01T00:00:00.000Z" },
    controller.signal
  );
  await vi.waitFor(() => {
    expect(transport).toHaveBeenCalledOnce();
  });
  expect(transport.mock.calls[0]?.[1]?.method).toBe("POST");
  expect(transport.mock.calls[0]?.[0]).toBe(
    "http://localhost/api/trpc/vault.read"
  );
  controller.abort();
  await expect(result).rejects.toThrow(/abort/i);
  expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});
