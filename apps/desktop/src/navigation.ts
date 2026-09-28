const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The renderer may load one configured HTTPS origin, or loopback in development. */
export function applicationUrl(value: string, packaged: boolean) {
  const url = new URL(value);
  const local =
    !packaged && url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !local)) {
    throw new Error(
      "Zoen requires HTTPS, or an HTTP loopback URL in development."
    );
  }
  return url;
}

export function isApplicationNavigation(value: string, origin: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === origin &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function isExternalWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
