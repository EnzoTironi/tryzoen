import { z } from "zod";
import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

const graphSchema = z.object({
  revision: z.string(),
  graph: z.object({
    entities: z.array(
      z.object({
        id: z.string(),
        properties: z.object({ status: z.string() }),
      })
    ),
  }),
});

export default defineEval({
  description:
    "Bind an ontology action to exact native approval, reject it, then approve a new proposal",
  tags: ["launch", "approval", "tools", "live-model", "synthetic-data"],
  timeoutMs: 240_000,
  async test(t) {
    const inspect = async () =>
      graphSchema.parse(await (await t.target.fetch("/_eval/ontology")).json());
    const before = await inspect();
    const proposed = await t.send(
      "Set the Beta release project's status to active in this workspace."
    );
    const session = proposed.session;
    proposed.parked();
    t.check((await inspect()).revision, equals(before.revision)).label(
      "no mutation before approval"
    );
    const first = session.requireInputRequest({
      toolName: "ontology-action",
      optionIds: ["approve", "cancel"],
      input: {
        entityId: "release_project",
        actionId: "project_status",
        value: "active",
        expectedRevision: before.revision,
      },
    });
    t.check(first.kind, equals("tool-approval"));
    const rejected = await session.respond([
      { requestId: first.requestId, optionId: "cancel" },
    ]);
    rejected.succeeded();
    t.calledTool("ontology-action", { status: "rejected", count: 1 });
    t.check((await inspect()).revision, equals(before.revision)).label(
      "rejection preserves the Git head"
    );
    const second = await session.send(
      "Please propose that same status change again. I will confirm it this time."
    );
    second.parked();
    const request = session.requireInputRequest({
      toolName: "ontology-action",
      optionIds: ["approve", "cancel"],
      input: {
        entityId: "release_project",
        actionId: "project_status",
        value: "active",
        expectedRevision: before.revision,
      },
    });
    t.check(request.requestId === first.requestId, equals(false)).label(
      "new proposal needs a new approval"
    );
    const approved = await session.respond([
      { requestId: request.requestId, optionId: "approve" },
    ]);
    approved.succeeded();
    approved.noFailedActions();
    t.calledTool("ontology-action", { status: "completed", count: 1 });
    const after = await inspect();
    t.check(
      after.graph.entities.find((entity) => entity.id === "release_project")
        ?.properties.status,
      equals("active")
    );
    t.check(after.revision === before.revision, equals(false)).label(
      "approved change has a new Git revision"
    );
  },
});
