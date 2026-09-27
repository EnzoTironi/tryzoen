import { describe, expect, it } from "vitest";
import { isSafeWebLink } from "./links";

describe("assistant link policy", () => {
  it("allows public web links without turning generated text into native commands", () => {
    expect(isSafeWebLink("https://example.com/doc#summary")).toBe(true);
    expect(isSafeWebLink("http://localhost:3000/report")).toBe(true);
    for (const value of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "zoen://delete-account",
      "data:text/html,hello",
      "https://password@example.com",
      "/relative",
    ]) {
      expect(isSafeWebLink(value)).toBe(false);
    }
  });
});
