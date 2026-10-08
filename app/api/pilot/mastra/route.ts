import { env } from "@shared/environment/env";
import { WorkspaceAccessDenied } from "../../../../server/workspaces/access";
import { pilotCommandSchema } from "../../../../server/mastra/contract";
import { z } from "zod";
import { readBody, BodyTooLarge } from "../../../../server/http/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function respond(request: Request, mutate: boolean) {
  if (!env.ZOEN_MASTRA_PILOT_ENABLED)
    return new Response(null, { status: 404 });
  if (mutate && request.headers.get("origin") !== new URL(request.url).origin)
    return new Response(null, { status: 403 });
  try {
    const { commandMastraPilot, readMastraPilot } =
      await import("../../../../server/mastra/pilot");
    if (mutate && Number(request.headers.get("content-length") ?? 0) > 32768)
      return new Response(null, { status: 413 });
    const body = mutate
      ? (await readBody(request.body, 32768)).toString("utf8")
      : "";
    const result = mutate
      ? await commandMastraPilot(
          request.headers,
          pilotCommandSchema.parse(JSON.parse(body))
        )
      : await readMastraPilot(
          request.headers,
          new URL(request.url).searchParams.get("conversation")
        );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status =
      error instanceof WorkspaceAccessDenied
        ? 403
        : error instanceof BodyTooLarge
          ? 413
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : error instanceof Error && error.name === "PilotBusy"
              ? 409
              : 503;
    return Response.json(
      {
        error:
          status === 403
            ? "Entre na sua conta para acessar esta conversa."
            : status === 409
              ? "Revise ou cancele a solicitação em andamento."
              : "Não foi possível concluir. Recarregue e tente novamente.",
      },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}
export function GET(request: Request) {
  return respond(request, false);
}
export function POST(request: Request) {
  return respond(request, true);
}
