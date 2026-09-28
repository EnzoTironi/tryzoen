import { Parser } from "htmlparser2";
import { publicFetch } from "../connectors/public-fetch";
import { requireWorkspaceAccess } from "../workspaces/access";
import type { z } from "zod";
import type { WorkspaceActorSchema } from "../workspaces/access";

/** Public HTML only: DNS-pinned transport, no cookies, redirects or JavaScript. */
export async function readLinkPreview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  value: string,
  signal?: AbortSignal
) {
  await requireWorkspaceAccess(actor);
  const url = new URL(value);
  url.hash = "";
  const options = {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8_000)])
      : AbortSignal.timeout(8_000),
    headers: { accept: "text/html,application/xhtml+xml" },
  };
  const response = await publicFetch(url, options);
  if (
    !response.ok ||
    !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(
      response.headers.get("content-type") ?? ""
    )
  )
    throw new Error("Preview unavailable");
  const metadata = new Map<string, string>();
  let inTitle = false;
  let pageTitle = "";
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "title") inTitle = true;
      if (name === "meta") {
        const key = (
          attributes.property ??
          attributes.name ??
          ""
        ).toLowerCase();
        if (
          [
            "og:title",
            "og:description",
            "og:image",
            "twitter:image",
            "description",
          ].includes(key) &&
          !metadata.has(key) &&
          !!attributes.content?.trim()
        )
          metadata.set(key, attributes.content.slice(0, 2048));
      }
    },
    ontext(text) {
      if (inTitle) pageTitle = (pageTitle + text).slice(0, 180);
    },
    onclosetag(name) {
      if (name === "title") inTitle = false;
    },
  });
  parser.end(await response.text());
  const title = (
    metadata.get("og:title") ?? (pageTitle.trim() ? pageTitle : url.hostname)
  )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180);
  const description = (
    metadata.get("og:description") ??
    metadata.get("description") ??
    ""
  )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 280);
  const imageUrl = metadata.get("og:image") ?? metadata.get("twitter:image");
  const image = imageUrl
    ? await previewImage(imageUrl, url, options.signal)
    : undefined;
  await requireWorkspaceAccess(actor);
  return { title, description, image };
}
async function previewImage(value: string, base: URL, signal: AbortSignal) {
  try {
    const url = new URL(value, base);
    url.hash = "";
    const response = await publicFetch(url, {
      signal,
      headers: { accept: "image/png,image/jpeg,image/webp,image/gif" },
    });
    const mime = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!response.ok || !mime || !/^image\/(?:png|jpeg|webp|gif)$/u.test(mime))
      return undefined;
    return `data:${mime};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  } catch {
    // The title and domain remain useful when a site's image is inaccessible.
    return undefined;
  }
}
