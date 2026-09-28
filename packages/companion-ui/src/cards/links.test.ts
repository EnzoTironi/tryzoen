import { expect, it } from "vitest";
import { messageLinks } from "./links";
import { linkPreviewInputSchema, linkPreviewSchema } from "./schema";
it("deduplicates and bounds previews while excluding code, mail and unsafe schemes", () => {
  expect(
    messageLinks(
      "See https://example.com/a twice https://example.com/a. Also https://example.org/b and https://example.net/c"
    )
  ).toEqual(["https://example.com/a", "https://example.org/b"]);
  expect(
    messageLinks(
      "`https://example.com`\n```\nhttps://example.org\n```\nme@example.net javascript:alert(1)"
    )
  ).toEqual([]);
  expect(messageLinks("https://user:password@example.com")).toEqual([]);
});
it("limits preview requests to public-transport compatible URLs and inert image data", () => {
  for (const url of [
    "file:///etc/passwd",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com:8443",
  ])
    expect(linkPreviewInputSchema.safeParse({ url }).success).toBe(false);
  expect(
    linkPreviewInputSchema.safeParse({ url: "https://example.com/page#part" })
      .success
  ).toBe(true);
  expect(
    linkPreviewSchema.safeParse({
      title: "Title",
      description: "",
      image: "https://tracking.example/image.png",
    }).success
  ).toBe(false);
});
