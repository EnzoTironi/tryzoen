import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { v5 as uuid } from "uuid";
import { z } from "zod";
import { WorkspacePublishSchema } from "@zoen/companion-ui/workspace-files";
import { SemanticDefinitionSchema } from "../../server/workspaces/semantic/schema.ts";
import { accessScopeForUser } from "../../shared/identity/access-scope.ts";
import {
  DEMO_STATE_DIRECTORY,
  DEMO_PORTS,
  assertDemoEnvironment,
  demoEnvironment,
} from "./stack.ts";

const seedId = "zoen-investor-demo-v1";
const workspaceId = "zoen-investor-demo-workspace";
const organizationId = "zoen-investor-demo-organization";
const receiptPath = join(DEMO_STATE_DIRECTORY, "seed.json");
const publicReceiptPath = join(DEMO_STATE_DIRECTORY, "seed-public.json");
const id = (name: string) => uuid(`${seedId}:${name}`, uuid.URL);
const people = [
  { key: "maya", name: "Maya Chen", username: "maya_chen" },
  { key: "imani", name: "Imani Brooks", username: "imani_brooks" },
  { key: "theo", name: "Theo Park", username: "theo_park" },
] as const;
const csv =
  "task,owner,status\nReview captions,Theo Park,in_review\nPrepare product captures,Imani Brooks,in_progress\nReview story outline,Maya Chen,in_review\nArchive old capture plan,Imani Brooks,done\n";
const model =
  "source: launch_tasks is snapshot.table('public.launch_tasks')\nquery: open_launch_tasks is launch_tasks -> {\n  select: task, owner, status\n  where: status != 'done'\n  order_by: owner asc, task asc\n}\n";
const queryPath = "knowledge/queries/open-launch-tasks.json";
const notesPath = "knowledge/launch-notes.md";
const notesA = "# Launch notes\n\nWalkthrough focus: desktop messaging.\n";
const notesB =
  "# Launch notes\n\nWalkthrough focus: desktop messaging and mobile navigation.\n";
const definition = SemanticDefinitionSchema.parse({
  version: 1,
  model: "knowledge/models/launch_tasks.malloy",
  query: "open_launch_tasks",
  parameters: {},
  sources: [
    {
      name: "launch_tasks",
      path: "knowledge/data/launch_tasks.csv",
      columns: ["task", "owner", "status"].map((name) => ({
        name,
        type: "text",
      })),
    },
  ],
});
const changes = [
  { path: "knowledge/data/launch_tasks.csv", content: csv },
  { path: "knowledge/models/launch_tasks.malloy", content: model },
  { path: queryPath, content: JSON.stringify(definition, null, 2) + "\n" },
  { path: notesPath, content: notesA },
];
const revision = z.string().regex(/^[a-f0-9]{40}$/u);
const receiptSchema = z.strictObject({
  seedId: z.literal(seedId),
  workspaceId: z.literal(workspaceId),
  people: z
    .array(
      z.strictObject({
        key: z.enum(["maya", "imani", "theo"]),
        userId: z.string(),
        authSessionId: z.uuid(),
        token: z.string().min(32),
        expiresAt: z.iso.datetime(),
      })
    )
    .length(3),
  sessionCookies: z.record(
    z.enum(["Maya Chen", "Imani Brooks", "Theo Park"]),
    z.string().min(32)
  ),
  baseRevision: revision.nullable().optional(),
  revisionA: revision.optional(),
  revisionB: revision.optional(),
  groupId: z.uuid().optional(),
  directId: z.uuid().optional(),
  threadRootId: z.string().optional(),
  completedAt: z.iso.datetime().optional(),
});

class DemoSeedError extends Error {}

async function saveReceipt(receipt: z.output<typeof receiptSchema>) {
  await mkdir(DEMO_STATE_DIRECTORY, { recursive: true, mode: 0o700 });
  await chmod(DEMO_STATE_DIRECTORY, 0o700);
  const temporary = receiptPath + ".tmp";
  await writeFile(temporary, JSON.stringify(receipt, null, 2) + "\n", {
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, receiptPath);
}

async function apply() {
  const environment = demoEnvironment();
  assertDemoEnvironment(environment);
  // Replace inherited provider settings with the stack owner's allowlist before importing database owners.
  // oxlint-disable-next-line eslint/no-restricted-properties
  process.env = environment;
  const [
    { env },
    { db },
    { query, transaction },
    { sql },
    { saveDirectoryProfile },
    rooms,
    direct,
    send,
    reactions,
    { WorkspaceRepository },
  ] = await Promise.all([
    import("../../shared/environment/env.ts"),
    import("../../db/index.ts"),
    import("../../db/queries.ts"),
    import("drizzle-orm"),
    import("../../server/accounts/directory.ts"),
    import("../../server/matrix/rooms.ts"),
    import("../../server/matrix/direct.ts"),
    import("../../server/matrix/send.ts"),
    import("../../server/matrix/reactions.ts"),
    import("../../server/workspaces/repository.ts"),
  ]);
  try {
    const database = await query<{ name: string }>(
      sql`SELECT current_database() AS name`
    );
    if (database[0]?.name !== "companion_investor_demo")
      throw new DemoSeedError(
        "Refusing to seed any database except companion_investor_demo on loopback port 15439."
      );
    if (!env.BETTER_AUTH_SECRET || !env.SECRET_ENCRYPTION_KEY)
      throw new DemoSeedError(
        "Both private demo installation secrets must be configured; automatic Blob provisioning is forbidden."
      );
    const signingSecret = env.BETTER_AUTH_SECRET;
    let receipt: z.output<typeof receiptSchema>;
    try {
      receipt = receiptSchema.parse(
        JSON.parse(await readFile(receiptPath, "utf8"))
      );
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw new DemoSeedError(
          "The private seed receipt is invalid or unreadable. Inspect it privately before retrying."
        );
      const existing = await query(sql`SELECT id FROM public.session
        WHERE id IN (${id("session:maya")}, ${id("session:imani")}, ${id("session:theo")}) LIMIT 1`);
      if (existing.length)
        throw new DemoSeedError(
          "Demo sessions already exist. Restore their private seed receipt before retrying; bearer tokens are never silently replaced."
        );
      const accounts = people.map((person) => ({
        key: person.key,
        userId: `${seedId}-${person.key}`,
        authSessionId: id(`session:${person.key}`),
        token: randomBytes(32).toString("base64url"),
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      }));
      receipt = receiptSchema.parse({
        seedId,
        workspaceId,
        people: accounts,
        sessionCookies: Object.fromEntries(
          accounts.map((account) => {
            const name = people.find(
              (person) => person.key === account.key
            )?.name;
            if (!name)
              throw new DemoSeedError(
                "Unknown fictional account in the private receipt."
              );
            const signature = createHmac("sha256", signingSecret)
              .update(account.token)
              .digest("base64");
            return [
              name,
              `better-auth.session_token=${encodeURIComponent(`${account.token}.${signature}`)}`,
            ] as const;
          })
        ),
      });
      await saveReceipt(receipt);
    }
    const identity = (key: (typeof people)[number]["key"]) => {
      const person = receipt.people.find((item) => item.key === key);
      if (
        !person ||
        person.userId !== `${seedId}-${key}` ||
        person.authSessionId !== id(`session:${key}`)
      )
        throw new DemoSeedError(
          "The private receipt does not identify the approved fictional accounts."
        );
      return person;
    };
    const actor = (key: (typeof people)[number]["key"]) => {
      const person = identity(key);
      return {
        userId: `better-auth:${person.userId}`,
        workspaceId,
        authSessionId: person.authSessionId,
      };
    };
    if (
      new Set(receipt.people.map((person) => person.key)).size !== people.length
    )
      throw new DemoSeedError(
        "The private receipt must contain Maya, Imani, and Theo exactly once."
      );
    if (
      receipt.people.some(
        (person) => Date.parse(person.expiresAt) <= Date.now()
      )
    )
      throw new DemoSeedError(
        "Demo sessions expired. Renew only this demo's sessions before retrying; the seed does not silently rotate credentials."
      );
    await transaction(async () => {
      for (const person of people) {
        const account = identity(person.key);
        const existing = await query<{ valid: boolean }>(sql`
          SELECT token = ${account.token} AND "userId" = ${account.userId} AS valid
          FROM public.session WHERE id = ${account.authSessionId} FOR SHARE`);
        if (existing[0] && !existing[0].valid)
          throw new DemoSeedError(
            "The private receipt does not match an existing demo session. Restore the matching receipt before retrying."
          );
      }
      await query(
        sql`INSERT INTO organizations (id, name) VALUES (${organizationId}, 'Fictional launch team') ON CONFLICT (id) DO NOTHING`
      );
      await query(
        sql`INSERT INTO workspaces (id, organization_id) VALUES (${workspaceId}, ${organizationId}) ON CONFLICT (id) DO NOTHING`
      );
      for (const person of people) {
        const account = identity(person.key);
        const portraitPath = join(
          DEMO_STATE_DIRECTORY,
          "portraits",
          `${person.key}.svg`
        );
        const portrait = await readFile(portraitPath);
        const image = `data:image/svg+xml;base64,${portrait.toString("base64")}`;
        await query(sql`INSERT INTO public.user (id, name, email, "emailVerified", image) VALUES
          (${account.userId}, ${person.name}, ${`${person.username}@demo.invalid`}, true, ${image})
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image = EXCLUDED.image`);
        await query(sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "updatedAt") VALUES
          (${account.authSessionId}, ${account.token}, ${account.userId}, ${new Date(account.expiresAt)}, now())
          ON CONFLICT (id) DO NOTHING`);
        const personal = accessScopeForUser(`better-auth:${account.userId}`);
        await query(
          sql`INSERT INTO workspaces (id) VALUES (${personal.workspaceId}) ON CONFLICT (id) DO NOTHING`
        );
        await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
          (${personal.workspaceId}, ${personal.userId}, 'owner') ON CONFLICT DO NOTHING`);
        const role = person.key === "imani" ? "admin" : "member";
        await query(sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES
          (${organizationId}, ${personal.userId}, ${role}) ON CONFLICT DO NOTHING`);
        await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
          (${workspaceId}, ${personal.userId}, ${role}) ON CONFLICT DO NOTHING`);
      }
    });
    for (const person of people)
      await saveDirectoryProfile(actor(person.key), {
        username: person.username,
        discoverable: false,
      });
    const owner = actor("imani");
    if (receipt.baseRevision === undefined) {
      receipt.baseRevision = await WorkspaceRepository.currentRevision(owner);
      await saveReceipt(receipt);
    }
    if (!receipt.revisionA) {
      receipt.revisionA = (
        await WorkspaceRepository.publish(
          owner,
          WorkspacePublishSchema.parse({
            operationId: id("publication:a"),
            expectedRevision: receipt.baseRevision,
            changes,
          })
        )
      ).revision;
      await saveReceipt(receipt);
    }
    if (!receipt.revisionB) {
      receipt.revisionB = (
        await WorkspaceRepository.write(owner, {
          operationId: id("publication:b"),
          expectedRevision: receipt.revisionA,
          path: notesPath,
          content: notesB,
        })
      ).revision;
      await saveReceipt(receipt);
    }
    const group = await rooms.createMatrixRoom(owner, {
      operationId: id("group:launch"),
      name: "Launch room",
    });
    // Join all fictional humans before sending; native joined-history never hides the opening exchange.
    for (const person of people)
      await rooms.readMatrixMessages(actor(person.key), group.id);
    const dm = await direct.openDirectRoom(owner, {
      operationId: id("direct:maya-imani"),
      username: "maya_chen",
    });
    await rooms.readMatrixMessages(actor("maya"), dm.id);
    await send.sendMatrixMessage(actor("maya"), {
      id: dm.id,
      operationId: id("message:dm-maya"),
      text: "Can we give the walkthrough one clear story?",
    });
    await send.sendMatrixMessage(owner, {
      id: dm.id,
      operationId: id("message:dm-imani"),
      text: "Start with the conversation. Then show the source.",
    });
    await send.sendMatrixMessage(actor("maya"), {
      id: group.id,
      operationId: id("message:group-maya"),
      text: "What still needs review before the walkthrough?",
    });
    const root = await send.sendMatrixMessage(owner, {
      id: group.id,
      operationId: id("message:group-imani"),
      text: "The capture plan is in Launch notes.",
    });
    await send.sendMatrixMessage(actor("theo"), {
      id: group.id,
      operationId: id("message:thread-theo"),
      rootId: root.event_id,
      text: "I’ll review the captions.",
    });
    await reactions.setMatrixReaction(actor("maya"), {
      id: group.id,
      operationId: id("reaction:plan"),
      messageId: root.event_id,
      emoji: "👍",
    });
    await send.sendMatrixMessage(actor("maya"), {
      id: group.id,
      operationId: id("message:group-review"),
      text: "Let’s check what changed.",
    });
    const history = await WorkspaceRepository.history(owner, notesPath);
    if (
      !history.some((entry) => entry.revision === receipt.revisionA) ||
      !history.some((entry) => entry.revision === receipt.revisionB)
    )
      throw new DemoSeedError(
        "Actual Launch notes history did not retain both seeded publications."
      );
    const [earlier, current, thread] = await Promise.all([
      WorkspaceRepository.read(owner, notesPath, receipt.revisionA),
      WorkspaceRepository.read(owner, notesPath, receipt.revisionB),
      rooms.readMatrixMessages(owner, group.id, undefined, root.event_id),
    ]);
    if (
      earlier.content !== notesA ||
      current.content !== notesB ||
      !thread.messages.some(
        (message) => message.text === "I’ll review the captions."
      )
    )
      throw new DemoSeedError(
        "The real backend did not return the expected notes revisions and thread."
      );
    receipt.groupId = group.id;
    receipt.directId = dm.id;
    receipt.threadRootId = root.event_id;
    receipt.completedAt = new Date().toISOString();
    await saveReceipt(receipt);
    const publicReceipt = {
      status: "seeded",
      seedId,
      workspaceId,
      organizationId,
      url: `http://127.0.0.1:${DEMO_PORTS.web}/companion?space=${encodeURIComponent(workspaceId)}`,
      profiles: people.map((person) => ({
        name: person.name,
        userId: identity(person.key).userId,
      })),
      groupId: group.id,
      directId: dm.id,
      threadRootId: root.event_id,
      revisionA: receipt.revisionA,
      revisionB: receipt.revisionB,
      query: { path: queryPath, revision: receipt.revisionB, arguments: {} },
      fictionalData: true,
      transport: "real private Synapse",
      seededAgentReplies: 0,
      modelTurns: 0,
    };
    await writeFile(
      publicReceiptPath,
      JSON.stringify(publicReceipt, null, 2) + "\n",
      { mode: 0o600 }
    );
    await chmod(publicReceiptPath, 0o600);
    console.log(
      JSON.stringify({ ...publicReceipt, receiptPath, publicReceiptPath })
    );
  } finally {
    await db.$client.end();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean" },
      check: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Seed the private Zoen investor demo through real backend owners.

Options:
  --check  Validate the authored payload and print the plan (default; no backend calls)
  --apply  Seed only companion_investor_demo at 127.0.0.1:15439 and Matrix :18039
  --help   Show this help

Examples:
  node --import tsx scripts/demo/seed.ts --check
  node --import tsx scripts/demo/seed.ts --apply

Run the demo stack preparation and migrations first. Copy the three approved fictional SVG portraits to demo-state/portraits. Auth sessions and signed cookies stay in the private 0600 seed receipt. Native Synapse transaction IDs and repository operation IDs make retries idempotent. No agent response is seeded and no model is invoked.`);
    return;
  }
  if (values.apply && values.check)
    throw new DemoSeedError("Choose --check or --apply, not both.");
  WorkspacePublishSchema.parse({
    operationId: id("publication:a"),
    expectedRevision: null,
    changes,
  });
  if (!values.apply) {
    console.log(
      JSON.stringify({
        status: "plan",
        database: "companion_investor_demo",
        databasePort: 15439,
        matrixPort: 18039,
        workspaceId,
        profiles: people.map((person) => person.name),
        files: changes.map((change) => change.path),
        notesVersions: 2,
        transport: "real private Synapse",
        seededAgentReplies: 0,
        modelTurns: 0,
        receiptPath,
        next: "node --import tsx scripts/demo/seed.ts --apply",
      })
    );
    return;
  }
  await apply();
}

await main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      status: "failed",
      message:
        error instanceof DemoSeedError
          ? error.message
          : "Seed did not complete. Inspect the private backend and receipt; credentials are never printed.",
      error: error instanceof Error ? error.name : "UnknownError",
    })
  );
  process.exitCode = 1;
});
