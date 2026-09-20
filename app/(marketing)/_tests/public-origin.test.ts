import { describe, expect, it } from "vitest";
import {
  companionAppHost,
  companionAppOrigin,
  companionCanonicalPath,
  companionPublicHost,
  companionPublicOrigin,
  publicHostRedirect,
} from "../public-origin";

describe("marketing public origin", () => {
  it("canonicalizes marketing URLs to tryzoen.com", () => {
    expect(companionPublicHost).toBe("tryzoen.com");
    expect(companionPublicOrigin).toBe("https://tryzoen.com");
    expect(companionAppHost).toBe("app.tryzoen.com");
    expect(companionAppOrigin).toBe("https://app.tryzoen.com");
    expect(companionCanonicalPath("/")).toBe("https://tryzoen.com/");
    expect(companionCanonicalPath("/docs")).toBe("https://tryzoen.com/docs");
  });
});

describe("public host redirect", () => {
  it("sends legacy marketing home to the apex landing", () => {
    expect(publicHostRedirect("zoen.tironi.xyz", "/")).toBe(
      "https://tryzoen.com/"
    );
    expect(publicHostRedirect("zoen.tironi.xyz", "/welcome", "?x=1")).toBe(
      "https://tryzoen.com/?x=1"
    );
    expect(publicHostRedirect("zoen.tironi.xyz", "/docs", "?lang=pt")).toBe(
      "https://tryzoen.com/docs?lang=pt"
    );
  });

  it("sends legacy app paths to app.tryzoen.com", () => {
    expect(publicHostRedirect("zoen.tironi.xyz", "/sign-in", "?next=/")).toBe(
      "https://app.tryzoen.com/sign-in?next=/"
    );
    expect(publicHostRedirect("zoen.tironi.xyz", "/chat")).toBe(
      "https://app.tryzoen.com/chat"
    );
    expect(publicHostRedirect("zoen.tironi.xyz", "/api/auth/ok")).toBe(
      "https://app.tryzoen.com/api/auth/ok"
    );
  });

  it("keeps health, Eve, Matrix and channel webhooks on the incoming host", () => {
    for (const path of [
      "/eve/v1/health",
      "/eve/v1/dev/schedules/dynamic",
      "/api/health",
      "/api/channels/telegram",
      "/api/channels/kapso",
      "/_matrix/app/v1/transactions/1",
      "/internal/scheduled-run/start",
    ]) {
      expect(publicHostRedirect("zoen.tironi.xyz", path)).toBeUndefined();
      expect(publicHostRedirect("tryzoen.com", path)).toBeUndefined();
      expect(publicHostRedirect("app.tryzoen.com", path)).toBeUndefined();
    }
  });

  it("splits www and apex without looping on the canonical hosts", () => {
    expect(publicHostRedirect("www.tryzoen.com", "/welcome", "?x=1")).toBe(
      "https://tryzoen.com/?x=1"
    );
    expect(publicHostRedirect("www.tryzoen.com", "/sign-in")).toBe(
      "https://app.tryzoen.com/sign-in"
    );
    expect(publicHostRedirect("tryzoen.com", "/welcome", "?x=1")).toBe(
      "https://tryzoen.com/?x=1"
    );
    expect(publicHostRedirect("tryzoen.com", "/sign-in")).toBe(
      "https://app.tryzoen.com/sign-in"
    );
    expect(publicHostRedirect("tryzoen.com", "/")).toBeUndefined();
    expect(publicHostRedirect("tryzoen.com", "/docs")).toBeUndefined();
    expect(publicHostRedirect("app.tryzoen.com", "/")).toBeUndefined();
    expect(publicHostRedirect("app.tryzoen.com", "/sign-in")).toBeUndefined();
    expect(publicHostRedirect("app.tryzoen.com", "/welcome")).toBe(
      "https://tryzoen.com/"
    );
    expect(publicHostRedirect("app.tryzoen.com", "/docs")).toBe(
      "https://tryzoen.com/docs"
    );
  });

  it("does not relocate localhost or fly.dev", () => {
    expect(publicHostRedirect("localhost", "/welcome")).toBeUndefined();
    expect(publicHostRedirect("127.0.0.1", "/sign-in")).toBeUndefined();
    expect(
      publicHostRedirect("companion-tironi.fly.dev", "/chat")
    ).toBeUndefined();
  });
});
