import { describe, expect, it } from "vitest";
import {
  applicationUrl,
  isApplicationNavigation,
  isExternalWebUrl,
} from "./navigation.js";

describe("desktop navigation boundary", () => {
  it("permits configured HTTPS and development loopback only", () => {
    expect(
      applicationUrl("https://app.tryzoen.com/companion", true).origin
    ).toBe("https://app.tryzoen.com");
    expect(applicationUrl("http://localhost:8081", false).hostname).toBe(
      "localhost"
    );
    for (const value of [
      "http://example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:secret@app.tryzoen.com",
    ]) {
      expect(() => applicationUrl(value, false)).toThrow("Zoen requires HTTPS");
    }
    expect(() => applicationUrl("http://localhost:8081", true)).toThrow(
      "Zoen requires HTTPS"
    );
  });

  it("does not confuse a lookalike, credential-bearing URL, or another port with the app", () => {
    const origin = "https://app.tryzoen.com";
    expect(isApplicationNavigation(`${origin}/companion/chat`, origin)).toBe(
      true
    );
    for (const value of [
      "https://app.tryzoen.com.evil.example",
      "https://app.tryzoen.com:4000",
      "https://user@app.tryzoen.com",
      "data:text/html,hello",
      "blob:https://app.tryzoen.com/synthetic-object-id",
      "not a url",
    ]) {
      expect(isApplicationNavigation(value, origin)).toBe(false);
    }
  });

  it("never hands local files or executable protocols to the operating system", () => {
    expect(isExternalWebUrl("https://example.com/report?q=1")).toBe(true);
    for (const value of [
      "file:///Applications/Other.app",
      "smb://server/share",
      "javascript:alert(1)",
      "http://example.com",
      "https://user:password@example.com",
      "invalid",
    ]) {
      expect(isExternalWebUrl(value)).toBe(false);
    }
  });
});
