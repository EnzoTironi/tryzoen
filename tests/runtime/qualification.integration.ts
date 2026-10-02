import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { resolveCapabilities } from "../../server/tools/catalog";
import { readPublishedSkills } from "../../server/tools/skills";
import { nativeContext } from "../helpers/native-tools";
import { requireVaultwarden } from "../../server/workspaces/vault";
import { requireWhatsAppBridge } from "../../server/workspaces/whatsapp";
import { recordTelemetry } from "../../server/observability/events";
import { readDiagnosticSession } from "../../server/observability/insights";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
test("discovers published skills and isolates diagnostics while providers are unavailable", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, guestPersonal, repository } = workspace;
  const context = workspaceExecutionFor(actor);
  const discovered = Object.keys(
    await resolveCapabilities(nativeContext(context))
  );
  expect(discovered.length).toBeGreaterThan(0);
  await repository.write(actor, {
    content: "# Qualification\n\nDo not treat this body as a live pass.",
    expectedRevision: null,
    operationId: randomUUID(),
    path: "skills/qualify.md",
  });
  const skills = await readPublishedSkills(actor);
  expect(skills.map((skill) => skill.path)).toContain("skills/qualify.md");
  await expect(requireWhatsAppBridge()).rejects.toBeInstanceOf(Error);
  await expect(requireVaultwarden()).rejects.toBeInstanceOf(Error);
  const planted = `totp-canary-${randomUUID()}`;
  const sessionId = `qualify-${randomUUID()}`;
  await recordTelemetry({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    sessionId,
    kind: "step.completed",
    name: "execute",
    channel: "eve",
    model: "synthetic",
    durationMs: 12,
    payload: {
      totp: planted,
      message: "synthetic executor step",
    },
  });
  const diagnostic = await readDiagnosticSession(actor, sessionId);
  const serialized = JSON.stringify(diagnostic);
  expect(serialized).not.toContain(planted);
  expect(diagnostic.events[0]).toMatchObject({
    kind: "step.completed",
    name: "execute",
    model: "synthetic",
    payload: null,
  });
  await expect(
    readDiagnosticSession(guestPersonal, sessionId)
  ).rejects.toBeInstanceOf(Error);
  await expect(readDiagnosticSession(guest, sessionId)).rejects.toBeInstanceOf(
    Error
  );
});
