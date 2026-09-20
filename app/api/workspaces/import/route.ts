import { withSignal } from "../../../../server/operations/async";
import { WorkspaceRepositoryError } from "../../../../server/workspaces/repository";
import { WorkspaceImportError } from "../../../../server/workspaces/import";
import { ZodError as SchemaError } from "zod";
import { WorkspaceAccessDenied } from "../../../../server/workspaces/access";
import { z } from "zod";
import { resolveWorkspaceActor } from "../../../../server/workspaces/session";
import { WorkspaceRepository } from "../../../../server/workspaces/repository";
import {
  convertWorkspaceDocument,
  workspaceImportBytes,
} from "../../../../server/workspaces/import";
import { isSameOrigin } from "@web/trpc/same-origin";
import { GitRevisionSchema } from "../../../../server/workspaces/git";

const importMetadata = z.object({
  operationId: z.uuid(),
  expectedRevision: z.nullable(GitRevisionSchema),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const length = Number(request.headers.get("content-length"));
  if (!length || length > workspaceImportBytes + 8192)
    return Response.json({ error: "too_large" }, { status: 413 });
  return withSignal(request.signal, async () => {
    try {
      const actor = await resolveWorkspaceActor(request.headers);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        return Response.json({ error: "invalid_document" }, { status: 400 });
      const metadata = await importMetadata.parseAsync({
        operationId: form.get("operationId"),
        expectedRevision: form.get("revision"),
      });
      const bytes = Buffer.from(await file.arrayBuffer());
      const converted = await convertWorkspaceDocument(file.name, bytes);
      const slug =
        file.name
          .replace(/\.[^.]+$/, "")
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) || "document";
      const path = `knowledge/${slug}.md`;
      const saved = await WorkspaceRepository.write(
        actor,
        {
          ...metadata,
          path,
          content: converted.content,
        },
        { kind: "import", filename: file.name, bytes }
      );
      return Response.json(
        { ...saved, path },
        { headers: { "cache-control": "private, no-store" } }
      );
    } catch (error) {
      if (error instanceof WorkspaceAccessDenied)
        return Response.json({ error: "forbidden" }, { status: 403 });
      if (error instanceof SchemaError)
        return Response.json({ error: "invalid_document" }, { status: 400 });
      if (error instanceof WorkspaceImportError)
        return Response.json(
          { error: error.reason },
          { status: error.reason === "too_large" ? 413 : 422 }
        );
      if (error instanceof WorkspaceRepositoryError)
        return Response.json(
          { error: error.reason },
          { status: error.reason === "conflict" ? 409 : 400 }
        );
      throw error;
    }
  });
}
