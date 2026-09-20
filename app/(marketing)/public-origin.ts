/** Canonical public hosts. Visual refs in copy are not hosts. */
const zoenMarketingHost = "tryzoen.com";
const zoenMarketingOrigin = "https://tryzoen.com";
const zoenAppHost = "app.tryzoen.com";
const zoenAppOrigin = "https://app.tryzoen.com";
const zoenWwwHost = "www.tryzoen.com";
const zoenLegacyHosts = ["zoen.tironi.xyz"] as const;

/** Marketing origin used by OG/Twitter/canonical tags. */
export const companionPublicHost = zoenMarketingHost;
export const companionPublicOrigin = zoenMarketingOrigin;
/** Product-app origin. Hosted BETTER_AUTH_URL / COMPANION_PUBLIC_BASE_URL. */
export const companionAppHost = zoenAppHost;
export const companionAppOrigin = zoenAppOrigin;

export function companionCanonicalPath(path: `/${string}`): string {
  return `${companionPublicOrigin}${path}`;
}

const marketingExact = new Set([
  "/",
  "/welcome",
  "/docs",
  "/pricing",
  "/get-started",
]);

/**
 * Health, Eve, Matrix and channel webhooks stay on the incoming host so Fly
 * checks and in-flight provider URLs keep working during the DNS cutover.
 */
function isInfrastructurePath(pathname: string) {
  if (pathname === "/api/health" || pathname === "/eve/v1/health") return true;
  if (pathname === "/icon" || pathname === "/favicon.ico") return true;
  if (pathname.startsWith("/eve/")) return true;
  if (pathname.startsWith("/_matrix/")) return true;
  if (pathname.startsWith("/internal/")) return true;
  if (pathname.startsWith("/api/channels/telegram")) return true;
  if (pathname.startsWith("/api/channels/kapso")) return true;
  return false;
}

function isMarketingPath(pathname: string) {
  if (marketingExact.has(pathname)) return true;
  return (
    pathname.startsWith("/docs/") ||
    pathname.startsWith("/pricing/") ||
    pathname.startsWith("/get-started/")
  );
}

function marketingHome(search: string) {
  return `${zoenMarketingOrigin}/${search}`;
}

function withOrigin(origin: string, pathname: string, search: string) {
  return `${origin}${pathname}${search}`;
}

/**
 * Permanent host split. Returns an absolute URL to 308 to, or `undefined`
 * when this request should stay on the incoming host.
 *
 * Context: one Fly app serves marketing on the apex and the product on
 * `app.tryzoen.com`. Legacy `zoen.tironi.xyz` and `www` map onto that split.
 * Inputs: hostname (no port), pathname, raw `search` including `?`.
 * Outputs: `https://tryzoen.com/…` or `https://app.tryzoen.com/…`.
 */
export function publicHostRedirect(
  hostname: string,
  pathname: string,
  search = ""
): string | undefined {
  const host = hostname.toLowerCase();
  if (isInfrastructurePath(pathname)) return undefined;

  const legacy = (zoenLegacyHosts as readonly string[]).includes(host);
  const www = host === zoenWwwHost;
  const marketing = host === zoenMarketingHost;
  const app = host === zoenAppHost;

  if (legacy || www) {
    if (pathname === "/" || pathname === "/welcome") return marketingHome(search);
    if (isMarketingPath(pathname))
      return withOrigin(zoenMarketingOrigin, pathname, search);
    return withOrigin(zoenAppOrigin, pathname, search);
  }

  if (marketing) {
    if (pathname === "/welcome") return marketingHome(search);
    if (!isMarketingPath(pathname))
      return withOrigin(zoenAppOrigin, pathname, search);
    return undefined;
  }

  if (app) {
    if (pathname === "/welcome") return marketingHome(search);
    if (isMarketingPath(pathname) && pathname !== "/")
      return withOrigin(zoenMarketingOrigin, pathname, search);
    return undefined;
  }

  return undefined;
}

export function isMarketingHost(hostname: string) {
  return hostname.toLowerCase() === zoenMarketingHost;
}

export function isAppHost(hostname: string) {
  return hostname.toLowerCase() === zoenAppHost;
}
