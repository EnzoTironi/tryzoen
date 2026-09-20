import { randomUUID } from "node:crypto";
import { createWorld } from "@workflow/world-postgres";
import { env } from "@shared/environment/env";
import { Pool } from "pg";
import { expect, test } from "vitest";

async function nativeStepFixture() {
  const owner = new Pool({
    connectionString: env.DATABASE_URL_UNPOOLED,
    max: 1,
  });
  const world = createWorld({
    connectionString: env.DATABASE_URL,
    maxPoolSize: 3,
  });
  const created = await world.events.create(null, {
    eventType: "run_created",
    specVersion: 7,
    eventData: {
      deploymentId: "postgres",
      workflowName: "workflow//atomic-proof",
      input: {},
    },
  });
  const runId = created.run.runId;
  const stepId = `atomic-probe-${randomUUID()}`;
  await world.events.create(runId, {
    eventType: "run_started",
    specVersion: 7,
  });
  await world.events.create(runId, {
    eventType: "step_created",
    correlationId: stepId,
    specVersion: 7,
    eventData: { stepName: "atomic-proof", input: {} },
  });
  await world.events.create(runId, {
    eventType: "step_started",
    correlationId: stepId,
    specVersion: 7,
  });
  return {
    world,
    owner,
    runId,
    stepId,
    completed: {
      eventType: "step_completed" as const,
      correlationId: stepId,
      specVersion: 7,
      eventData: { result: { written: true } },
    },
    failed: {
      eventType: "step_failed" as const,
      correlationId: stepId,
      specVersion: 7,
      eventData: { error: new TextEncoder().encode("synthetic-error") },
    },
    async journal() {
      return (
        await owner.query<{ type: string }>(
          "SELECT type FROM workflow.workflow_events WHERE run_id=$1 AND correlation_id=$2 AND type IN ('step_completed','step_failed')",
          [runId, stepId]
        )
      ).rows;
    },
    async [Symbol.asyncDispose]() {
      try {
        await owner.query(
          "DROP TRIGGER IF EXISTS zoen_test_terminal_event ON workflow.workflow_events; DROP FUNCTION IF EXISTS workflow.zoen_test_reject_terminal_event()"
        );
        await world.events.create(runId, {
          eventType: "run_completed",
          specVersion: 7,
          eventData: { output: {} },
        });
      } finally {
        await world.close?.();
        await owner.end();
      }
    },
  };
}

test.each(["completed", "failed"] as const)(
  "a %s step and its replay event roll back together on journal failure",
  async (outcome) => {
    await using fixture = await nativeStepFixture();
    const { owner, world, runId, stepId } = fixture;
    // Interrupt the actual journal INSERT after the guarded step UPDATE.
    await owner.query(`CREATE FUNCTION workflow.zoen_test_reject_terminal_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.correlation_id LIKE 'atomic-probe-%' AND NEW.type IN ('step_completed','step_failed') THEN
        RAISE EXCEPTION 'Synthetic terminal journal failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER zoen_test_terminal_event BEFORE INSERT ON workflow.workflow_events
    FOR EACH ROW EXECUTE FUNCTION workflow.zoen_test_reject_terminal_event()`);
    await expect(
      world.events.create(runId, fixture[outcome])
    ).rejects.toMatchObject({
      cause: { message: "Synthetic terminal journal failure" },
    });
    expect((await world.steps.get(runId, stepId)).status).toBe("running");
    expect(await fixture.journal()).toEqual([]);
    await owner.query(
      "DROP TRIGGER zoen_test_terminal_event ON workflow.workflow_events; DROP FUNCTION workflow.zoen_test_reject_terminal_event()"
    );
    await world.events.create(runId, fixture[outcome]);
    const opposite =
      outcome === "completed" ? fixture.failed : fixture.completed;
    await expect(world.events.create(runId, opposite)).rejects.toMatchObject({
      name: "EntityConflictError",
    });
    expect((await world.steps.get(runId, stepId)).status).toBe(outcome);
    expect(await fixture.journal()).toEqual([{ type: `step_${outcome}` }]);
    const events = await world.events.list({ runId });
    expect(events.data.map((event) => event.eventId).toSorted()).toEqual(
      Array.from(
        { length: 5 },
        (_, index) => `evnt_${String(index + 1).padStart(26, "0")}`
      )
    );
  }
);

test("concurrent success and failure commit one matching terminal state and replay event", async () => {
  await using fixture = await nativeStepFixture();
  const { world, runId, stepId } = fixture;
  const results = await Promise.allSettled([
    world.events.create(runId, fixture.completed),
    world.events.create(runId, fixture.failed),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { name: "EntityConflictError" },
  });
  const step = await world.steps.get(runId, stepId);
  expect(["completed", "failed"]).toContain(step.status);
  expect(await fixture.journal()).toEqual([{ type: `step_${step.status}` }]);
});
