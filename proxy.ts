import { NextResponse, type NextRequest } from "next/server";
import { getAuthSession } from "@db/services/auth/session";
import {
  isAppHost,
  isMarketingHost,
  publicHostRedirect,
  companionPublicOrigin,
} from "@app/(marketing)/public-origin";

const publicExact = new Set([
  "/sign-in",
  "/sign-in/device",
  "/get-started",
  "/welcome",
  "/pricing",
  "/docs",
  "/icon",
  "/favicon.ico",
  "/api/health",
  "/api/channels/telegram",
  "/api/channels/kapso",
  "/internal/channel-input/respond",
  "/eve/v1/health",
  "/eve/v1/dev/schedules/dynamic",
]);

function isPublicPath(pathname: string) {
  if (publicExact.has(pathname)) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/_matrix/app/v1/")) return true;
  if (pathname.startsWith("/internal/scheduled-run/")) return true;
  if (
    /^\/agents\/[a-z0-9_]{3,30}(?:\/\.well-known\/agent-card\.json)?$/.test(
      pathname
    )
  )
    return true;
  return false;
}

function requestHostname(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-host");
  const header =
    forwarded ?? request.headers.get("host") ?? request.nextUrl.host;
  const [first] = header.split(",");
  const [host] = (first ?? "").trim().split(":");
  return (host ?? "").toLowerCase();
}

function rewriteLanding(request: NextRequest) {
  const url = new URL("/welcome", request.url);
  url.search = request.nextUrl.search;
  return NextResponse.rewrite(url);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hostname = requestHostname(request);

  const relocated = publicHostRedirect(hostname, pathname, search);
  if (relocated) return NextResponse.redirect(relocated, 308);

  if (pathname === "/welcome") {
    const home = new URL("/", request.url);
    home.search = search;
    return NextResponse.redirect(home, 308);
  }

  if (pathname === "/" && isMarketingHost(hostname)) {
    return rewriteLanding(request);
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (await getAuthSession(request.headers)) {
    const headers = new Headers(request.headers);
    if (!pathname.startsWith("/api/") && !pathname.startsWith("/eve/")) {
      const workspace = request.nextUrl.searchParams.get("space");
      if (workspace) headers.set("x-zoen-workspace", workspace);
      else headers.delete("x-zoen-workspace");
    }
    return NextResponse.next({ request: { headers } });
  }

  if (pathname === "/") {
    if (isAppHost(hostname)) {
      return NextResponse.redirect(`${companionPublicOrigin}/${search}`, 308);
    }
    return rewriteLanding(request);
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|fonts|marketing/|favicon.ico|icon$).*)",
  ],
};
