import { createHash } from "node:crypto";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { sessionSourceSchema } from "../session-files";
import { sessionSourceSegments } from "../session-files";
import type { openMemoryEngine } from "./engine";

const scope = { workspace: "zoen", project: "private" };
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Upstream 2.4.1's assistant hook protocol excludes generic/Eve clients. */
export async function ingestSessionSource(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  namespaceId: string,
  source: z.infer<typeof sessionSourceSchema>
) {
  if (source.role === "assistant") return;
  const sessionId = uuidv5(
    JSON.stringify([source.sessionId, source.turnId]),
    z.uuid().parse(namespaceId)
  );
  const marker = `zoenevent${digest(JSON.stringify(source))}`;
  const segments = sessionSourceSegments(source);
  const envelope = (
    event: string,
    sourceEvent: string,
    key: string,
    body: Record<string, unknown>
  ) => ({
    url: `/hook?${new URLSearchParams({ ...scope, agent: "other", extension: "eve", event, source_event: sourceEvent, ingest_key: key })}`,
    body: { ...body, session_id: sessionId, cwd: "/zoen/private" },
  });
  // Stable on replay, including when a later source reopens this worker.
  await engine.deliver([
    envelope("session-start", "archive.opened", digest(`${sessionId}:start`), {
      title: "Eve turn archive",
      occurred_at: source.occurredAt,
    }),
  ]);
  const before = await readSourceReceipts(
    engine.client,
    sessionId,
    source,
    segments.length
  );
  const isBoundary = source.role === null;
  const pending = segments.filter(
    (part) => isBoundary || !before.has(part.segment.index)
  );
  for (let offset = 0; offset < pending.length; offset += 64) {
    await engine.deliver(
      pending.slice(offset, offset + 64).map((part) => {
        const footer = `[Zoen archive ${marker} part=${part.segment.index}/${part.segment.count}]`;
        const body = `${part.text ?? source.kind}\n\n${footer}`;
        return envelope(
          isBoundary ? "session-end" : "user-prompt",
          source.kind,
          digest(`${source.eventId}:${part.segment.index}`),
          {
            ...(isBoundary ? { body, title: source.kind } : { prompt: body }),
            occurred_at: source.occurredAt,
          }
        );
      })
    );
  }
  if (
    (
      await readSourceReceipts(
        engine.client,
        sessionId,
        source,
        segments.length
      )
    ).size !== segments.length
  )
    throw new Error("Session memory did not persist every source segment.");
}

const sourceReceiptPage = z.object({
  total: z.number().int().nonnegative(),
  observations: z
    .array(
      z.object({
        extension: z.string().nullable(),
        source_event: z.string().nullable(),
        body: z.string(),
      })
    )
    .max(200),
});

async function readSourceReceipts(
  client: Client,
  sessionId: string,
  source: z.infer<typeof sessionSourceSchema>,
  segmentCount: number
) {
  const marker = `zoenevent${digest(JSON.stringify(source))}`;
  const found = new Set<number>();
  let offset = 0;
  do {
    const result = await client.callTool(
      {
        name: "memory_read_session_observations",
        arguments: {
          ...scope,
          session_id: sessionId,
          query: marker,
          limit: 200,
          offset,
          body_max_chars: 16384,
        },
      },
      undefined,
      { timeout: 15_000 }
    );
    if (result.isError)
      throw new Error("Cannot verify session memory delivery.");
    const blocks = z
      .array(z.object({ type: z.literal("text"), text: z.string() }))
      .parse(result.content);
    const page = sourceReceiptPage.parse(
      JSON.parse(blocks.map((block) => block.text).join("\n"))
    );
    if (page.total > segmentCount)
      throw new Error("Session memory source receipt conflict.");
    for (const observation of page.observations) {
      const footer =
        /\[Zoen archive (zoenevent[a-f0-9]{64}) part=(\d+)\/(\d+)\]$/.exec(
          observation.body
        );
      if (
        observation.extension !== "eve" ||
        observation.source_event !== source.kind ||
        footer?.[1] !== marker ||
        Number(footer[3]) !== segmentCount
      )
        throw new Error("Session memory provenance verification failed.");
      const index = Number(footer[2]);
      if (index >= segmentCount || found.has(index))
        throw new Error("Session memory segment receipt conflict.");
      found.add(index);
    }
    offset += page.observations.length;
    if (offset >= page.total) return found;
    if (!page.observations.length)
      throw new Error("Session memory receipt pagination made no progress.");
  } while (offset < segmentCount);
  return found;
}
