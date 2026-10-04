import { z } from "zod";
import { getAuthSession } from "@db/services/auth/session";
import { readReadyBrowserImageArtifact } from "@db/services/browser-images";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: RouteContext<"/artifacts/[artifactId]">
) {
  const session = await getAuthSession(request.headers);
  const parsedId = z.uuid().safeParse((await context.params).artifactId);
  if (!session || !parsedId.success) return notFound();
  const artifact = await readReadyBrowserImageArtifact(
    `better-auth:${session.user.id}`,
    parsedId.data,
    {
      signal: request.signal,
    }
  );
  if (!artifact) return notFound();
  const headers = privateImageHeaders();
  const etag = `"${artifact.contentHash}"`;
  headers.set("etag", etag);
  const matches = request.headers
    .get("if-none-match")
    ?.split(",")
    .some(
      (value) =>
        value.trim() === "*" || value.trim().replace(/^W\//u, "") === etag
    );
  if (matches) return new Response(null, { headers, status: 304 });
  headers.set("content-length", String(artifact.byteSize));
  headers.set("content-type", artifact.mediaType);
  headers.set("content-disposition", contentDisposition(artifact.filename));
  return new Response(new Uint8Array(artifact.bytes), { headers, status: 200 });
}

function notFound() {
  return new Response("Not found", {
    headers: privateImageHeaders(),
    status: 404,
  });
}

function privateImageHeaders() {
  return new Headers({
    "cache-control": "private, no-store",
    "content-security-policy": "default-src 'none'; sandbox",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
}

function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
