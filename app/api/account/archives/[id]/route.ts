import { withSignal } from "../../../../../server/operations/async";
import { SqlError } from "../../../../../db/queries";
import { AccountMemoryArchiveUnavailable } from "../../../../../server/accounts/archive-entitlement";
import { MemoryNamespaceError } from "../../../../../server/memory/namespace";
import { WorkspaceAccessDenied } from "../../../../../server/workspaces/access";
import { SessionArchiveUnavailable } from "../../../../../server/memory/session-export";
import { PrivateMemoryArchiveError } from "../../../../../server/memory/archive";
import { AuthUnavailable } from "../../../../../db/services/auth/index";
import { ZodError as SchemaError } from "zod";
import { AccountArchiveMissing } from "../../../../../server/accounts/archives";
import { AccountControlError } from "../../../../../server/accounts/controls";
import { z } from "zod";
import { downloadAccountArchive } from "../../../../../server/accounts/archives";

export async function GET(
  request: Request,
  context: RouteContext<"/api/account/archives/[id]">
) {
  const { id } = await context.params;
  const query = new URL(request.url).searchParams;
  return withSignal(request.signal, async () => {
    try {
      try {
        try {
          const section = await z
            .enum([
              "memory",
              "private-memory",
              "files",
              "attachment",
              "source",
              "creator",
              "creator-release",
            ])
            .parseAsync(query.get("section"));
          return await downloadAccountArchive(
            request.headers,
            id,
            section,
            query.get("attachment") ?? undefined
          );
        } catch (error) {
          if (error instanceof AccountControlError)
            return new Response("Sign in to continue", {
              status: 401,
              headers: { "cache-control": "no-store" },
            });
          throw error;
        }
      } catch (error) {
        if (
          error instanceof AccountArchiveMissing ||
          error instanceof SchemaError
        )
          return new Response("Not found", {
            status: 404,
            headers: { "cache-control": "no-store" },
          });
        throw error;
      }
    } catch (error) {
      if (error instanceof WorkspaceAccessDenied)
        return new Response("Archive access denied", {
          status: 403,
          headers: { "cache-control": "private, no-store" },
        });
      if (error instanceof MemoryNamespaceError && error.reason === "erased")
        return new Response("Archive generation is being erased", {
          status: 409,
          headers: { "cache-control": "private, no-store" },
        });
      if (
        error instanceof AuthUnavailable ||
        error instanceof AccountMemoryArchiveUnavailable ||
        error instanceof SessionArchiveUnavailable ||
        error instanceof PrivateMemoryArchiveError ||
        error instanceof SqlError
      )
        return new Response("Archive unavailable", {
          status: 503,
          headers: { "cache-control": "no-store" },
        });
      throw error;
    }
  });
}
