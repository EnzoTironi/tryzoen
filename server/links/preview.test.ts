import { beforeEach, expect, it, vi } from "vitest";
import { publicFetch } from "../connectors/public-fetch";
import { requireWorkspaceAccess } from "../workspaces/access";
import { readLinkPreview } from "./preview";
vi.mock("../connectors/public-fetch", () => ({
  publicFetch: vi.fn<typeof publicFetch>(),
}));
vi.mock("../workspaces/access", () => ({
  requireWorkspaceAccess: vi.fn<typeof requireWorkspaceAccess>(),
}));
const actor = {
  userId: "review-user",
  workspaceId: "review-workspace",
} as Parameters<typeof readLinkPreview>[0];
beforeEach(() => {
  vi.resetAllMocks();
});
it("parses real metadata and proxies the bounded image through the same public transport", async () => {
  vi.mocked(publicFetch)
    .mockResolvedValueOnce(
      new Response(
        '<title>Fallback</title><meta property="og:title" content="Notes &amp; ideas"><meta name="description" content="A shared notebook"><meta property="og:image" content="/cover.png">',
        { headers: { "content-type": "text/html; charset=utf-8" } }
      )
    )
    .mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      })
    );
  expect(
    await readLinkPreview(actor, "https://example.com/notes#section")
  ).toEqual({
    title: "Notes & ideas",
    description: "A shared notebook",
    image: "data:image/png;base64,AQID",
  });
  expect(vi.mocked(publicFetch).mock.calls[0]?.[0]).toEqual(
    new URL("https://example.com/notes")
  );
  expect(vi.mocked(publicFetch).mock.calls[1]?.[0]).toEqual(
    new URL("https://example.com/cover.png")
  );
  expect(requireWorkspaceAccess).toHaveBeenCalledTimes(2);
});
it("does not contact a site without current workspace access", async () => {
  vi.mocked(requireWorkspaceAccess).mockRejectedValue(new Error("Denied"));
  await expect(readLinkPreview(actor, "https://example.com")).rejects.toThrow(
    "Denied"
  );
  expect(publicFetch).not.toHaveBeenCalled();
});
it("rejects non-HTML responses and keeps inaccessible images optional", async () => {
  vi.mocked(publicFetch).mockResolvedValueOnce(
    new Response("secret", { headers: { "content-type": "application/json" } })
  );
  await expect(readLinkPreview(actor, "https://example.com")).rejects.toThrow(
    "Preview unavailable"
  );
  vi.mocked(publicFetch)
    .mockResolvedValueOnce(
      new Response(
        '<title>Available title</title><meta property="og:image" content="https://127.0.0.1/image">',
        { headers: { "content-type": "text/html" } }
      )
    )
    .mockRejectedValueOnce(new Error("Connector endpoint is not public."));
  expect(await readLinkPreview(actor, "https://example.com")).toEqual({
    title: "Available title",
    description: "",
    image: undefined,
  });
});
it("never embeds active image formats or a malformed image URL", async () => {
  vi.mocked(publicFetch).mockResolvedValueOnce(
    new Response(
      '<title>Safe title</title><meta property="og:image" content="https://[broken">',
      { headers: { "content-type": "text/html" } }
    )
  );
  expect(
    (await readLinkPreview(actor, "https://example.com")).image
  ).toBeUndefined();
  vi.mocked(publicFetch)
    .mockResolvedValueOnce(
      new Response(
        '<title>Safe title</title><meta property="og:image" content="/cover.svg">',
        { headers: { "content-type": "text/html" } }
      )
    )
    .mockResolvedValueOnce(
      new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })
    );
  expect(
    (await readLinkPreview(actor, "https://example.com")).image
  ).toBeUndefined();
});
