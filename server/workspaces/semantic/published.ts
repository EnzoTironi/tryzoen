import { SemanticQueryResultSchema } from "@zoen/companion-ui/semantic-query";
import { parse } from "csv-parse/sync";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { WorkspaceActorSchema } from "../access";
import { WorkspaceAccessDenied } from "../access";
import { WorkspaceRepository } from "../repository";
import { SemanticDefinitionSchema, SemanticQuerySchema } from "./schema";
import { executeSemanticSnapshot } from "./execute";

export async function executePublishedSemanticQuery(
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.input<typeof SemanticQuerySchema>
) {
  // Shared and external execution need an explicitly qualified publication contract.
  if (actor.agentGrantId || actor.groupBindingId)
    throw new WorkspaceAccessDenied();
  const input = SemanticQuerySchema.parse(raw);
  const captured = await WorkspaceRepository.selection(actor, async (read) => {
    const first = await read([input.path]);
    if (first.length !== 1) return [];
    const definition = SemanticDefinitionSchema.parse(
      JSON.parse(first[0]?.content ?? "null")
    );
    return [
      ...first,
      ...(await read([
        ...new Set([
          definition.model,
          ...definition.sources.map((source) => source.path),
        ]),
      ])),
    ];
  });
  if (captured.revision !== input.revision || !captured.documents.length)
    throw new Error(
      "Published query is unavailable or changed; discover it again"
    );
  const definition = SemanticDefinitionSchema.parse(
    JSON.parse(captured.documents[0]?.content ?? "null")
  );
  if (
    Object.keys(input.arguments).length !==
      Object.keys(definition.parameters).length ||
    Object.entries(definition.parameters).some(
      ([key, type]) => typeof input.arguments[key] !== type
    )
  )
    throw new Error("Query arguments do not match its published definition");
  const paths = [
    ...new Set([
      input.path,
      definition.model,
      ...definition.sources.map((source) => source.path),
    ]),
  ];
  if (captured.documents.length !== paths.length)
    throw new Error(
      "Published sources are unavailable or changed; discover them again"
    );
  const documents = new Map(
    captured.documents.map((document) => [document.path, document.content])
  );
  const tables = definition.sources.map((source) => {
    const rows = z
      .array(z.array(z.string()))
      .max(2001)
      .parse(
        parse(documents.get(source.path) ?? "", {
          bom: true,
          skip_empty_lines: true,
          max_record_size: 131072,
        })
      );
    const header = rows.shift();
    if (
      !header ||
      header.length !== source.columns.length ||
      header.some((value, index) => value !== source.columns[index]?.name)
    )
      throw new Error("CSV columns do not match the published definition");
    return {
      name: source.name,
      columns: source.columns,
      rows: rows.map((row) =>
        row.map((value, index) => {
          const column = source.columns[index];
          if (!column) throw new Error("CSV column is unavailable");
          switch (column.type) {
            case "text":
              return value;
            case "date":
              return z.iso.date().parse(value);
            case "boolean":
              return z.enum(["true", "false"]).parse(value) === "true";
            case "numeric": {
              if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
                throw new Error("Invalid numeric CSV value");
              return value;
            }
            default:
              throw new Error("Unsupported CSV column type");
          }
        })
      ),
    };
  });
  const result = await executeSemanticSnapshot({
    model: documents.get(definition.model) ?? "",
    query: definition.query,
    arguments: input.arguments,
    tables,
  });
  // No result or manifest escapes if access or any captured publication changes during work.
  if ((await WorkspaceRepository.currentRevision(actor)) !== input.revision)
    throw new WorkspaceAccessDenied();
  const response = SemanticQueryResultSchema.parse({
    rows: result.rows,
    manifest: {
      ...result.manifest,
      id: randomUUID(),
      actor: actor.userId,
      workspaceId: actor.workspaceId,
      revision: input.revision,
      query: input.path,
      arguments: input.arguments,
      sql: result.sql,
      sources: captured.documents.map((document) => ({
        path: document.path,
        sha256: createHash("sha256").update(document.content).digest("hex"),
      })),
      freshness: "Published CSV snapshot; live provider freshness is unknown",
    },
  });
  if (
    Buffer.byteLength(JSON.stringify(response)) >
    result.manifest.limits.resultBytes
  )
    throw new Error("Semantic result and manifest exceed their byte limit");
  return response;
}
