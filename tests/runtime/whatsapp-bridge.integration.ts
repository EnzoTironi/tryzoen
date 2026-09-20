import { Secret } from "@shared/environment/secret";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type * as Environment from "@shared/environment";
import { contactNetworkBot } from "../../server/workspaces/network";

import { removeWorkspaceMember } from "../../server/workspaces/team";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import {
  authorizeWhatsAppChat,
  authorizeWhatsAppDraft,
  confirmWhatsAppPairing,
  ConfirmWhatsAppPairingSchema,
  draftWhatsAppMessage,
  importWhatsAppContacts,
  ingestWhatsAppEvent,
  listWhatsAppAccounts,
  listWhatsAppChats,
  pauseWhatsAppBridge,
  readWhatsAppMessages,
  requireWhatsAppBridge,
  resumeWhatsAppBridge,
  revokeWhatsAppBridge,
  sendWhatsAppDraft,
  shareWhatsAppChat,
  startWhatsAppPairing,
  summarizeWhatsAppChat,
  WhatsAppBridgeUnavailable,
} from "../../server/workspaces/whatsapp";
import {
  MATRIX_HS_TOKEN,
  whatsappBridgeFixture,
} from "./whatsapp-bridge-fixture";

import { workspaceFixture } from "./workspace-fixture";

vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_MATRIX_URL: "http://127.0.0.1:14351",
      ZOEN_MATRIX_SERVER_NAME: "zoen.test",
      ZOEN_MATRIX_AS_TOKEN: new Secret(
        "synthetic-zoen-matrix-appservice-token-32b"
      ),
      ZOEN_MATRIX_HS_TOKEN: new Secret(
        "synthetic-zoen-matrix-homeserver-token-32bx"
      ),
      ZOEN_WHATSAPP_BRIDGE_URL: "http://127.0.0.1:14351",
      ZOEN_WHATSAPP_PROVISIONING_SECRET: new Secret(
        "synthetic-whatsapp-provision-secret-32b"
      ),
      ZOEN_WHATSAPP_AS_TOKEN: new Secret(
        "synthetic-whatsapp-appservice-token-32bxx"
      ),
    },
  };
});

const denied = (
  result: { ok: true; value: unknown } | { ok: false; error: unknown }
) => {
  expect(!result.ok).toBe(true);
};
let fixture: Awaited<ReturnType<typeof whatsappBridgeFixture>>;
beforeAll(async () => {
  fixture = await whatsappBridgeFixture();
});
afterAll(async () => {
  await fixture.close();
});

const connect = async function (
  owner: Parameters<typeof startWhatsAppPairing>[0],
  remoteUserId: string
) {
  const pairing = await startWhatsAppPairing(owner);
  if (!pairing.matrixUserId)
    throw new WhatsAppBridgeUnavailable({ reason: "unpaired" });
  fixture.completeLogin(pairing.matrixUserId, remoteUserId);
  await confirmWhatsAppPairing({
    accountId: pairing.id,
    pairingNonce: pairing.pairingNonce,
  });
  return pairing.id;
};

test("WhatsApp user bridge stays unavailable without a paired mautrix session", async () => {
  const result = await Promise.try(async () => requireWhatsAppBridge()).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!result.ok && result.error).toBeInstanceOf(WhatsAppBridgeUnavailable);
  fixture.setReady(false);
  const down = await Promise.try(async () => requireWhatsAppBridge()).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!down.ok && down.error).toBeInstanceOf(WhatsAppBridgeUnavailable);
  fixture.setReady(true);
  return true;
});

test("the agent reads only authorized chats and never delivers without a live session", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal } = workspace;
  const dmCanary = `canary-dm-${randomUUID()}`;
  const groupCanary = `canary-group-${randomUUID()}`;
  const dmRemote = `dm:${randomUUID()}`;
  const groupRemote = `group:${randomUUID()}`;
  const roomId = `!dm-${randomUUID()}:zoen.test`;
  denied(
    await Promise.try(async () => startWhatsAppPairing(actor)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () => startWhatsAppPairing(guest)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  const pairing = await startWhatsAppPairing(personal);
  expect(pairing.qr).toBe("synthetic-whatsapp-qr");
  denied(
    await Promise.try(async () =>
      confirmWhatsAppPairing({
        accountId: pairing.id,
        pairingNonce: "kapso-bot-session",
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      ConfirmWhatsAppPairingSchema.strict().parseAsync({
        accountId: pairing.id,
        pairingNonce: pairing.pairingNonce,
        remoteUserId: `wa:${randomUUID()}`,
        botToken: "kapso-secret",
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      confirmWhatsAppPairing({
        accountId: pairing.id,
        pairingNonce: pairing.pairingNonce,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  const remoteUserId = `wa:${randomUUID()}`;
  fixture.completeLogin(pairing.matrixUserId ?? "", remoteUserId);
  await confirmWhatsAppPairing({
    accountId: pairing.id,
    pairingNonce: pairing.pairingNonce,
  });
  const listed = await listWhatsAppAccounts(personal);
  expect(listed.map((row) => row.handle)).toEqual([pairing.id]);
  expect(JSON.stringify(listed)).not.toContain(pairing.pairingNonce);
  expect(listed[0]?.status).toBe("connected");
  expect(listed[0]?.remoteUserId).toBe(remoteUserId);
  const dm = await authorizeWhatsAppChat(personal, {
    remoteChatId: dmRemote,
    kind: "dm",
    matrixRoomId: roomId,
  });
  const group = await authorizeWhatsAppChat(personal, {
    remoteChatId: groupRemote,
    kind: "group",
  });
  const backfill = await ingestWhatsAppEvent({
    accountId: pairing.id,
    remoteChatId: dmRemote,
    providerEventId: "evt-1",
    kind: "backfill",
    authorRemoteId: "wa:peer",
    body: dmCanary,
  });
  expect(backfill.alert).toBe(false);
  expect(
    await ingestWhatsAppEvent({
      accountId: pairing.id,
      remoteChatId: dmRemote,
      providerEventId: "evt-1",
      kind: "live",
      authorRemoteId: "wa:peer",
      body: dmCanary,
    })
  ).toEqual({ id: backfill.id, duplicate: true, alert: false });
  expect(
    (
      await ingestWhatsAppEvent({
        accountId: pairing.id,
        remoteChatId: dmRemote,
        providerEventId: "evt-2",
        kind: "live",
        authorRemoteId: "wa:peer",
        body: dmCanary,
      })
    ).alert
  ).toBe(true);
  await ingestWhatsAppEvent({
    accountId: pairing.id,
    remoteChatId: groupRemote,
    providerEventId: "evt-3",
    kind: "live",
    authorRemoteId: "wa:peer",
    body: groupCanary,
  });
  const inboundId = `$wa-${randomUUID()}`;
  await acceptMatrixTransaction(
    new Request("http://localhost/transactions", {
      method: "PUT",
      headers: { authorization: `Bearer ${MATRIX_HS_TOKEN}` },
      body: JSON.stringify({
        events: [
          {
            event_id: inboundId,
            room_id: roomId,
            type: "m.room.message",
            sender: "@whatsapp_peer:zoen.test",
            content: { body: `${dmCanary}-matrix`, msgtype: "m.text" },
          },
        ],
      }),
    }),
    randomUUID()
  );
  expect(
    (await readWhatsAppMessages(personal, { chatId: dm.id })).map(
      (row) => row.body
    )
  ).toEqual(expect.arrayContaining([dmCanary, `${dmCanary}-matrix`]));
  denied(
    await Promise.try(async () =>
      readWhatsAppMessages(actor, { chatId: dm.id })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      shareWhatsAppChat(personal, {
        chatId: dm.id,
        workspaceId: actor.workspaceId,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  await shareWhatsAppChat(personal, {
    chatId: group.id,
    workspaceId: actor.workspaceId,
  });
  expect((await listWhatsAppChats(actor)).map((chat) => chat.handle)).toEqual([
    group.id,
  ]);
  expect(
    (await summarizeWhatsAppChat(guest, { chatId: group.id })).text
  ).toContain(groupCanary);
  const companyDm = await Promise.try(async () =>
    summarizeWhatsAppChat(actor, {
      chatId: dm.id,
    })
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  denied(companyDm);
  expect(JSON.stringify(companyDm)).not.toContain(dmCanary);
  await pauseWhatsAppBridge(personal);
  expect(
    (
      await ingestWhatsAppEvent({
        accountId: pairing.id,
        remoteChatId: dmRemote,
        providerEventId: "evt-4",
        kind: "live",
        authorRemoteId: "wa:peer",
        body: dmCanary,
      })
    ).alert
  ).toBe(false);
  const draft = await draftWhatsAppMessage(personal, {
    chatId: dm.id,
    body: "I arrive at eight.",
  });
  await authorizeWhatsAppDraft(personal, draft.id);
  denied(
    await Promise.try(async () => sendWhatsAppDraft(personal, draft.id)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  await resumeWhatsAppBridge(personal);
  await query(sql`UPDATE whatsapp_bridge_drafts SET body = 'changed after approval'
        WHERE id = ${draft.id}`);
  denied(
    await Promise.try(async () => sendWhatsAppDraft(personal, draft.id)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  await authorizeWhatsAppDraft(personal, draft.id);
  const sent = await sendWhatsAppDraft(personal, draft.id);
  expect(sent).toEqual({ queued: true, submitted: true });
  expect(fixture.sends.at(-1)).toMatchObject({
    body: "changed after approval",
    roomId,
  });
  const queued = await query<{
    status: string;
  }>(sql`SELECT status FROM whatsapp_bridge_drafts WHERE id = ${draft.id}`);
  expect(queued[0]?.status).toBe("queued");
  await revokeWhatsAppBridge(personal);
  expect(fixture.logouts.length).toBeGreaterThan(0);
  denied(
    await Promise.try(async () =>
      readWhatsAppMessages(personal, { chatId: dm.id })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  expect(await listWhatsAppChats(personal)).toEqual([]);
  return true;
});

test("imported WhatsApp contacts do not grant trust and member removal ends a share", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal, guestPersonal } = workspace;
  const remote = `wa:${randomUUID()}`;
  const groupRemote = `group:${randomUUID()}`;
  await connect(guestPersonal, remote);
  const pairing = await startWhatsAppPairing(personal);
  fixture.completeLogin(pairing.matrixUserId ?? "", remote);
  denied(
    await Promise.try(async () =>
      confirmWhatsAppPairing({
        accountId: pairing.id,
        pairingNonce: pairing.pairingNonce,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  fixture.completeLogin(pairing.matrixUserId ?? "", `wa:${randomUUID()}`);
  await confirmWhatsAppPairing({
    accountId: pairing.id,
    pairingNonce: pairing.pairingNonce,
  });
  const group = await authorizeWhatsAppChat(guestPersonal, {
    remoteChatId: groupRemote,
    kind: "group",
  });
  await ingestWhatsAppEvent({
    accountId: (await listWhatsAppAccounts(guestPersonal))[0]?.handle ?? "",
    remoteChatId: groupRemote,
    providerEventId: "evt-share",
    kind: "live",
    authorRemoteId: "wa:peer",
    body: "guest-group",
  });
  await shareWhatsAppChat(guestPersonal, {
    chatId: group.id,
    workspaceId: actor.workspaceId,
  });
  expect((await listWhatsAppChats(actor)).map((chat) => chat.handle)).toEqual([
    group.id,
  ]);
  await importWhatsAppContacts(personal, {
    contacts: [{ remoteUserId: "wa:imported", name: "Imported Peer" }],
  });
  const directory = await query<{
    count: number;
  }>(sql`SELECT count(*)::int AS count FROM user_directory
        WHERE user_id = ${personal.userId.replace("better-auth:", "")}`);
  expect(directory[0]?.count).toBe(0);
  const trust = await query<{
    count: number;
  }>(sql`SELECT count(*)::int AS count FROM personal_trust_edges
        WHERE user_id = ${personal.userId}`);
  expect(trust[0]?.count).toBe(0);
  denied(
    await Promise.try(async () =>
      contactNetworkBot(personal, {
        destUsername: "importedpeer",
        message: {
          messageId: randomUUID(),
          role: "ROLE_USER",
          parts: [{ text: "hello" }],
        },
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  await removeWorkspaceMember(actor, guest.userId);
  denied(
    await Promise.try(async () =>
      listWhatsAppChats({
        userId: guest.userId,
        workspaceId: actor.workspaceId,
        authSessionId: guest.authSessionId,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  expect(await listWhatsAppChats(actor)).toEqual([]);
  return true;
});
