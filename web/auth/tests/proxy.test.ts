/* oxlint-disable vitest/require-mock-type-parameters -- The auth mock implements only the proxy boundary exercised here. */
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthSession } from "@db/services/auth/session";
import { config, proxy } from "../../../proxy";

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}));

vi.mock("@db/services/auth/session", () => ({
  getAuthSession: mocks.getAuthSession,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthSession.mockResolvedValue(null);
});

describe("auth proxy matcher", () => {
  it("does not match the generated document icon", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/icon",
      })
    ).toBe(false);
  });

  it.each([
    "/fonts/vault-variable.woff2",
    "/marketing/stars.webp",
    "/marketing/whatsapp.avif",
  ])("does not match public asset %s", (url) => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url,
      })
    ).toBe(false);
  });

  it("continues to match protected application routes", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/vault",
      })
    ).toBe(true);
  });

  it("leaves scheduled-run authorization to the Eve channel", async () => {
    const response = await proxy(
      new NextRequest("https://example.com/internal/scheduled-run/start")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("leaves native approval callback authentication to its signed Eve endpoint", async () => {
    const response = await proxy(
      new NextRequest("https://example.com/internal/channel-input/respond", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it.each([
    "/internal/channel-input/other",
    "/internal/channel-input/respond/other",
  ])("does not open unrelated internal path %s", async (path) => {
    const response = await proxy(new NextRequest(`https://example.com${path}`));
    expect(response.status).toBe(307);
    expect(getAuthSession).toHaveBeenCalledOnce();
  });

  it("allows consumer get-started without a browser session", async () => {
    const response = await proxy(
      new NextRequest("https://example.com/get-started")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("allows marketing pricing and docs without a browser session", async () => {
    const responses = await Promise.all(
      (["/pricing", "/docs"] as const).map((path) =>
        proxy(new NextRequest(`https://example.com${path}`))
      )
    );
    for (const response of responses) {
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("serves the marketing landing at / on a combined local host", async () => {
    const response = await proxy(new NextRequest("https://example.com/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://example.com/welcome"
    );
    expect(getAuthSession).toHaveBeenCalledOnce();
  });

  it("lets an authenticated visitor keep the workspace on a combined host", async () => {
    mocks.getAuthSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await proxy(new NextRequest("https://example.com/"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
  });

  it("permanently folds /welcome into / on a combined local host", async () => {
    const response = await proxy(
      new NextRequest("https://example.com/welcome?x=1")
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://example.com/?x=1");
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("sends legacy marketing home to tryzoen.com and app paths to the app host", async () => {
    const welcome = await proxy(
      new NextRequest("https://zoen.tironi.xyz/welcome?x=1")
    );
    expect(welcome.status).toBe(308);
    expect(welcome.headers.get("location")).toBe("https://tryzoen.com/?x=1");

    const signIn = await proxy(
      new NextRequest("https://zoen.tironi.xyz/sign-in?callbackUrl=%2Fchat")
    );
    expect(signIn.status).toBe(308);
    expect(signIn.headers.get("location")).toBe(
      "https://app.tryzoen.com/sign-in?callbackUrl=%2Fchat"
    );
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("rewrites the apex landing and sends apex app paths to app.tryzoen.com", async () => {
    const home = await proxy(new NextRequest("https://tryzoen.com/?ref=1"));
    expect(home.status).toBe(200);
    expect(home.headers.get("x-middleware-rewrite")).toBe(
      "https://tryzoen.com/welcome?ref=1"
    );

    const signIn = await proxy(new NextRequest("https://tryzoen.com/sign-in"));
    expect(signIn.status).toBe(308);
    expect(signIn.headers.get("location")).toBe(
      "https://app.tryzoen.com/sign-in"
    );
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("keeps the authenticated app home on app.tryzoen.com", async () => {
    mocks.getAuthSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await proxy(new NextRequest("https://app.tryzoen.com/"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
  });

  it("sends signed-out app home and marketing paths to the apex", async () => {
    const home = await proxy(new NextRequest("https://app.tryzoen.com/"));
    expect(home.status).toBe(308);
    expect(home.headers.get("location")).toBe("https://tryzoen.com/");

    const docs = await proxy(new NextRequest("https://app.tryzoen.com/docs"));
    expect(docs.status).toBe(308);
    expect(docs.headers.get("location")).toBe("https://tryzoen.com/docs");
  });

  it("honors Host when the request URL is a loopback or Fly address", async () => {
    const response = await proxy(
      new NextRequest("http://127.0.0.1:3010/welcome?x=1", {
        headers: { host: "zoen.tironi.xyz" },
      })
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://tryzoen.com/?x=1");
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("does not relocate Eve health on the legacy host", async () => {
    const response = await proxy(
      new NextRequest("https://zoen.tironi.xyz/eve/v1/health")
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("allows the document icon and favicon without a browser session", async () => {
    const responses = await Promise.all(
      (["/icon", "/favicon.ico"] as const).map((path) =>
        proxy(new NextRequest(`https://example.com${path}`))
      )
    );
    for (const response of responses) {
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("allows the schedule dispatcher without a browser session in development", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/eve/v1/dev/schedules/dynamic")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(getAuthSession).not.toHaveBeenCalled();
  });
});
