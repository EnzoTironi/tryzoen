import { withSignal } from "../../../../../server/operations/async";
import { SqlError } from "../../../../../db/queries";
import { Mem0Error } from "../../../../../server/memory/mem0";
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
            .enum(["memory", "files", "attachment", "source"])
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
      if (
        error instanceof AuthUnavailable ||
        error instanceof Mem0Error ||
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
