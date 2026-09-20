import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "@shared/environment";
import {
  assertWhatsAppBridgeReady,
  logoutWhatsApp,
  sendWhatsAppPortalMessage,
  startWhatsAppLogin,
  whoamiWhatsApp,
  WhatsAppBridgeUnavailable,
} from "../whatsapp/client";
import type { MatrixEventSchema } from "../matrix/client";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
export { WhatsAppBridgeUnavailable };
const remoteId = z.string().min(1).max(128);
const messageBody = z.string().min(1).max(8000);
const uuid = z.uuid();
export const ConfirmWhatsAppPairingSchema = z.object({
  accountId: uuid,
  pairingNonce: z.string().min(1).max(200),
});
const AuthorizeWhatsAppChatSchema = z.object({
  remoteChatId: remoteId,
  kind: z.enum(["dm", "group"]),
  matrixRoomId: z.optional(z.string().min(1).max(255)),
});
const IngestWhatsAppEventSchema = z.object({
  accountId: uuid,
  remoteChatId: remoteId,
  providerEventId: remoteId,
  kind: z.enum(["backfill", "live"]),
  authorRemoteId: remoteId,
  body: messageBody,
  matrixEventId: z.optional(z.string().min(1).max(255)),
});
const WhatsAppChatIdSchema = z.object({
  chatId: uuid,
});
export const ShareWhatsAppChatSchema = z.object({
  chatId: uuid,
  workspaceId: z.string().min(1).max(200),
});
const ImportWhatsAppContactsSchema = z.object({
  contacts: z
    .array(
      z.object({
        remoteUserId: remoteId,
        name: z.string().min(1).max(120),
      })
    )
    .min(1)
    .max(100),
});
const WhatsAppDraftSchema = z.object({
  chatId: uuid,
  body: messageBody,
});
const decode =
  <S extends z.ZodType>(schema: S) =>
  (input: unknown) =>
    schema.parseAsync(input);
const chatSchema = z.object({
  handle: z.string(),
  kind: z.string(),
  remoteChatId: z.string(),
});
const accountSchema = z.object({
  available: z.boolean(),
  handle: z.string(),
  remoteUserId: z.nullable(z.string()),
  status: z.string(),
});

/**
 * mautrix-whatsapp is the hosted user-owned WhatsApp bridge. Pairing a person's
 * WhatsApp is not the Kapso Cloud API bot and is not a Beeper Desktop channel.
 * Missing URL, an unhealthy bridge, or an unpaired phone fail closed.
 */
export const requireWhatsAppBridge = async function (matrixUserId?: string) {
  await assertWhatsAppBridgeReady();
  if (!matrixUserId)
    throw new WhatsAppBridgeUnavailable({
      reason: "unpaired",
    });
  const whoami = await whoamiWhatsApp(matrixUserId);
  if (!whoami.loggedIn || !whoami.remoteUserId)
    throw new WhatsAppBridgeUnavailable({
      reason: "unpaired",
    });
  return whoami;
};
export const listWhatsAppAccounts = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  await requireWorkspaceAccess(actor);
  const pairing = await query<{
    id: string;
    matrix_user_id: string | null;
  }>(sql`SELECT id, matrix_user_id FROM whatsapp_bridge_accounts
      WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL
        AND status = 'pairing' AND expires_at > now()`);
  for (const row of pairing) {
    if (row.matrix_user_id)
      await completePairingFromBridge(row.id, row.matrix_user_id).catch(() =>
        Promise.resolve()
      );
  }
  const rows = await query<{
    handle: string;
    remote_user_id: string | null;
    status: string;
  }>(sql`SELECT id AS handle, remote_user_id, status
      FROM whatsapp_bridge_accounts
      WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL`);
  return await z.array(accountSchema).parseAsync(
    rows.map((row) => ({
      available: row.status === "connected",
      handle: row.handle,
      remoteUserId: row.remote_user_id,
      status: row.status,
    }))
  );
};
export const startWhatsAppPairing = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const pairing = await withDatabaseTransaction(async () => {
    const access = await requirePersonalOwner(actor);
    await query(sql`UPDATE whatsapp_bridge_accounts
          SET status = 'revoked', revoked_at = clock_timestamp(), pairing_nonce_hash = 'revoked'
          WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL
            AND status = 'pairing' AND expires_at <= now()`);
    const nonce = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const expiresAt = new Date(new Date().getTime() + 15 * 60000);
    const matrixUserId = await resolvePairingMatrixUserId(actor.userId);
    await Promise.try(async () =>
      query(sql`INSERT INTO whatsapp_bridge_accounts(
            id, workspace_id, user_id, pairing_nonce_hash, matrix_user_id, status, expires_at
          ) VALUES (
            ${id}, ${actor.workspaceId}, ${access.userId}, ${hashNonce(nonce)},
            ${matrixUserId}, 'pairing', ${expiresAt}
          )`)
    ).catch(() => {
      throw new WorkspaceAccessDenied();
    });
    return {
      id,
      matrixUserId,
      pairingNonce: nonce,
    };
  });
  const started = await startBridgeLogin(pairing.id, pairing.matrixUserId);
  return {
    available: false as const,
    id: pairing.id,
    loginId: started.loginId,
    matrixUserId: pairing.matrixUserId,
    pairingNonce: pairing.pairingNonce,
    qr: started.qr,
  };
};
export const confirmWhatsAppPairing = async function (
  raw: z.output<typeof ConfirmWhatsAppPairingSchema>
) {
  const input = await decode(ConfirmWhatsAppPairingSchema)(raw);
  return await withDatabaseTransaction(async () => {
    const rows = await query<{
      pairing_nonce_hash: string;
      matrix_user_id: string | null;
    }>(sql`SELECT pairing_nonce_hash, matrix_user_id FROM whatsapp_bridge_accounts
          WHERE id = ${input.accountId} AND status = 'pairing' AND revoked_at IS NULL
            AND expires_at > now() FOR UPDATE`);
    const account = rows[0];
    if (
      !account ||
      account.pairing_nonce_hash !== hashNonce(input.pairingNonce)
    )
      throw new WorkspaceAccessDenied();
    if (!account.matrix_user_id)
      throw new WhatsAppBridgeUnavailable({
        reason: "unpaired",
      });
    const whoami = await requireWhatsAppBridge(account.matrix_user_id);
    if (!whoami.remoteUserId)
      throw new WhatsAppBridgeUnavailable({
        reason: "unpaired",
      });
    await completeConnectedAccount(
      input.accountId,
      whoami.remoteUserId,
      account.matrix_user_id,
      whoami.loginId
    );
    return {
      connected: true as const,
    };
  });
};
export const authorizeWhatsAppChat = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof AuthorizeWhatsAppChatSchema>
) {
  const input = await decode(AuthorizeWhatsAppChatSchema)(raw);
  return await withDatabaseTransaction(async () => {
    const account = await requireAccount(actor, true);
    const existing = await query<{
      id: string;
    }>(sql`SELECT id FROM whatsapp_bridge_chats
          WHERE account_id = ${account.id} AND remote_chat_id = ${input.remoteChatId}
            AND revoked_at IS NULL FOR UPDATE`);
    if (existing[0]) {
      if (input.matrixRoomId)
        await query(sql`UPDATE whatsapp_bridge_chats
              SET matrix_room_id = ${input.matrixRoomId}
              WHERE id = ${existing[0].id} AND revoked_at IS NULL`);
      return {
        id: existing[0].id,
      };
    }
    const id = randomUUID();
    await query(sql`INSERT INTO whatsapp_bridge_chats(id, account_id, remote_chat_id, kind, matrix_room_id)
          VALUES (${id}, ${account.id}, ${input.remoteChatId}, ${input.kind}, ${input.matrixRoomId ?? null})`);
    return {
      id,
    };
  });
};
export const listWhatsAppChats = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor);
  const rows = access.organizationId
    ? await query<{
        handle: string;
        kind: string;
        remote_chat_id: string;
      }>(sql`SELECT c.id AS handle, c.kind, c.remote_chat_id
        FROM whatsapp_bridge_shares s
        JOIN whatsapp_bridge_chats c ON c.id = s.chat_id
        JOIN whatsapp_bridge_accounts a ON a.id = c.account_id
        WHERE s.workspace_id = ${actor.workspaceId} AND s.revoked_at IS NULL
          AND c.revoked_at IS NULL AND a.revoked_at IS NULL
          AND a.status IN ('connected', 'paused')
        ORDER BY c.remote_chat_id`)
    : await query<{
        handle: string;
        kind: string;
        remote_chat_id: string;
      }>(sql`SELECT c.id AS handle, c.kind, c.remote_chat_id
        FROM whatsapp_bridge_chats c
        JOIN whatsapp_bridge_accounts a ON a.id = c.account_id
        WHERE a.workspace_id = ${actor.workspaceId} AND c.revoked_at IS NULL
          AND a.revoked_at IS NULL AND a.status IN ('connected', 'paused')
        ORDER BY c.remote_chat_id`);
  return await z.array(chatSchema).parseAsync(
    rows.map((row) => ({
      handle: row.handle,
      kind: row.kind,
      remoteChatId: row.remote_chat_id,
    }))
  );
};
export const ingestWhatsAppEvent = async function (
  raw: z.output<typeof IngestWhatsAppEventSchema>
) {
  const input = await decode(IngestWhatsAppEventSchema)(raw);
  return await withDatabaseTransaction(async () => {
    const accounts = await query<{
      id: string;
      status: string;
    }>(sql`SELECT id, status FROM whatsapp_bridge_accounts
        WHERE id = ${input.accountId} AND revoked_at IS NULL FOR UPDATE`);
    const account = accounts[0];
    if (!account) throw new WorkspaceAccessDenied();
    const chats = await query<{
      id: string;
    }>(sql`SELECT id FROM whatsapp_bridge_chats
        WHERE account_id = ${account.id} AND remote_chat_id = ${input.remoteChatId}
          AND revoked_at IS NULL FOR UPDATE`);
    const chat = chats[0];
    if (!chat) throw new WorkspaceAccessDenied();
    return await insertWhatsAppEvent({
      accountId: account.id,
      alert: input.kind === "live" && account.status === "connected",
      authorRemoteId: input.authorRemoteId,
      body: input.body,
      chatId: chat.id,
      kind: input.kind,
      matrixEventId: input.matrixEventId ?? null,
      providerEventId: input.providerEventId,
    });
  });
};

/** Store a Matrix portal event for an authorized WhatsApp chat. Echo from the puppet is ignored. */
export const ingestWhatsAppMatrixEvent = async function (
  event: z.output<typeof MatrixEventSchema>
) {
  if (
    event.type !== "m.room.message" ||
    event.content.msgtype !== "m.text" ||
    !event.room_id ||
    !event.content.body?.trim() ||
    event.content.body.length > 8000
  )
    return false;
  const chats = await query<{
    id: string;
    account_id: string;
    status: string;
    matrix_user_id: string | null;
    remote_user_id: string | null;
  }>(sql`SELECT c.id, c.account_id, a.status, a.matrix_user_id, a.remote_user_id
      FROM whatsapp_bridge_chats c
      JOIN whatsapp_bridge_accounts a ON a.id = c.account_id
      WHERE c.matrix_room_id = ${event.room_id} AND c.revoked_at IS NULL
        AND a.revoked_at IS NULL AND a.status IN ('connected', 'paused')
      FOR UPDATE OF c, a`);
  const chat = chats[0];
  if (!chat) return false;
  if (
    event.sender === chat.matrix_user_id ||
    (chat.remote_user_id && event.sender === puppetUserId(chat.remote_user_id))
  )
    return true;
  await insertWhatsAppEvent({
    accountId: chat.account_id,
    alert: chat.status === "connected",
    authorRemoteId: event.sender,
    body: event.content.body,
    chatId: chat.id,
    kind: "live",
    matrixEventId: event.event_id,
    providerEventId: event.event_id,
  });
  return true;
};
export const readWhatsAppMessages = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof WhatsAppChatIdSchema>
) {
  const input = await decode(WhatsAppChatIdSchema)(raw);
  const chat = await requireVisibleChat(actor, input.chatId);
  const rows = await query<{
    id: string;
    author_remote_id: string;
    body: string;
    kind: string;
  }>(sql`SELECT id, author_remote_id, body, kind FROM whatsapp_bridge_events
      WHERE chat_id = ${chat.id} ORDER BY occurred_at, created_at`);
  return rows.map((row) => ({
    authorRemoteId: row.author_remote_id,
    body: row.body,
    id: row.id,
    kind: row.kind,
  }));
};
export const summarizeWhatsAppChat = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof WhatsAppChatIdSchema>
) {
  const messages = await readWhatsAppMessages(actor, raw);
  return {
    coverage: messages.some((message) => message.kind === "live")
      ? ("complete" as const)
      : ("partial" as const),
    originIds: messages.map((message) => message.id),
    text: messages.map((message) => message.body).join("\n"),
  };
};
export const shareWhatsAppChat = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof ShareWhatsAppChatSchema>
) {
  const input = await decode(ShareWhatsAppChatSchema)(raw);
  return await withDatabaseTransaction(async () => {
    const chat = await requireOwnedChat(actor, input.chatId);
    if (chat.kind !== "group") throw new WorkspaceAccessDenied();
    const dest = await query(sql`SELECT w.id FROM workspaces w
          JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = ${actor.userId}
          JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = ${actor.userId}
          WHERE w.id = ${input.workspaceId} AND w.organization_id IS NOT NULL FOR SHARE OF w, m, o`);
    if (!dest.length) throw new WorkspaceAccessDenied();
    await Promise.try(async () =>
      query(sql`INSERT INTO whatsapp_bridge_shares(id, chat_id, workspace_id, issued_by)
        VALUES (${randomUUID()}, ${chat.id}, ${input.workspaceId}, ${actor.userId})
        ON CONFLICT (chat_id, workspace_id) WHERE revoked_at IS NULL DO NOTHING`)
    ).catch(() => Promise.resolve());
    const live = await query<{
      id: string;
    }>(sql`SELECT id FROM whatsapp_bridge_shares
        WHERE chat_id = ${chat.id} AND workspace_id = ${input.workspaceId} AND revoked_at IS NULL`);
    if (!live[0]) throw new WorkspaceAccessDenied();
    return {
      id: live[0].id,
    };
  });
};
export const importWhatsAppContacts = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof ImportWhatsAppContactsSchema>
) {
  const input = await decode(ImportWhatsAppContactsSchema)(raw);
  return await withDatabaseTransaction(async () => {
    const account = await requireAccount(actor, true);
    for (const contact of input.contacts) {
      await query(sql`INSERT INTO whatsapp_bridge_contacts(id, account_id, remote_user_id, display_name)
            VALUES (${randomUUID()}, ${account.id}, ${contact.remoteUserId}, ${contact.name})
            ON CONFLICT (account_id, remote_user_id) DO UPDATE SET display_name = EXCLUDED.display_name`);
    }
    return {
      imported: input.contacts.length,
    };
  });
};
export const draftWhatsAppMessage = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof WhatsAppDraftSchema>
) {
  const input = await decode(WhatsAppDraftSchema)(raw);
  return await withDatabaseTransaction(async () => {
    const chat = await requireOwnedChat(actor, input.chatId);
    const id = randomUUID();
    await query(sql`INSERT INTO whatsapp_bridge_drafts(
            id, account_id, chat_id, body, status, issued_by
          ) VALUES (${id}, ${chat.accountId}, ${chat.id}, ${input.body}, 'draft', ${actor.userId})`);
    return {
      id,
    };
  });
};
export const authorizeWhatsAppDraft = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  const draftId = await decode(uuid)(id);
  return await withDatabaseTransaction(async () => {
    await requirePersonalOwner(actor);
    const updated =
      await query(sql`UPDATE whatsapp_bridge_drafts d SET status = 'authorized',
            authorized_body = d.body, authorized_chat_id = d.chat_id
          FROM whatsapp_bridge_accounts a
          WHERE d.id = ${draftId} AND d.account_id = a.id AND a.workspace_id = ${actor.workspaceId}
            AND a.revoked_at IS NULL AND d.status IN ('draft', 'authorized')
            AND d.issued_by = ${actor.userId}
          RETURNING d.id`);
    if (!updated.length) throw new WorkspaceAccessDenied();
    return {
      authorized: true as const,
    };
  });
};
export const sendWhatsAppDraft = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  const draftId = await decode(uuid)(id);
  const queued = await withDatabaseTransaction(async () => {
    const account = await requireAccount(actor, true);
    if (account.status !== "connected") throw new WorkspaceAccessDenied();
    const updated = await query<{
      body: string;
      chat_id: string;
      matrix_room_id: string | null;
      matrix_user_id: string | null;
      remote_user_id: string | null;
    }>(sql`UPDATE whatsapp_bridge_drafts d SET status = 'queued', queued_at = clock_timestamp()
          FROM whatsapp_bridge_chats c, whatsapp_bridge_accounts a
          WHERE d.id = ${draftId} AND d.account_id = ${account.id} AND d.issued_by = ${actor.userId}
            AND d.status = 'authorized' AND d.authorized_body = d.body AND d.authorized_chat_id = d.chat_id
            AND c.id = d.chat_id AND a.id = d.account_id
          RETURNING d.authorized_body AS body, d.chat_id, c.matrix_room_id, a.matrix_user_id, a.remote_user_id`);
    const row = updated[0];
    if (!row) throw new WorkspaceAccessDenied();
    return row;
  });
  if (
    !queued.matrix_user_id ||
    !queued.remote_user_id ||
    !queued.matrix_room_id
  )
    throw new WhatsAppBridgeUnavailable({
      reason: "unpaired",
    });
  await requireWhatsAppBridge(queued.matrix_user_id);
  await sendWhatsAppPortalMessage({
    body: queued.body,
    puppetUserId: puppetUserId(queued.remote_user_id),
    roomId: queued.matrix_room_id,
    txnId: draftId,
  });
  return {
    queued: true as const,
    submitted: true as const,
  };
};
export const pauseWhatsAppBridge = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  return await setAccountStatus(actor, "connected", "paused");
};
export const resumeWhatsAppBridge = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const account = await requireAccount(actor, true);
  const rows = await query<{
    matrix_user_id: string | null;
  }>(sql`SELECT matrix_user_id FROM whatsapp_bridge_accounts
      WHERE id = ${account.id}`);
  await requireWhatsAppBridge(rows[0]?.matrix_user_id ?? undefined);
  return await setAccountStatus(actor, "paused", "connected");
};
export const revokeWhatsAppBridge = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const account = await withDatabaseTransaction(async () => {
    const current = await requireAccount(actor, true);
    const rows = await query<{
      matrix_user_id: string | null;
      login_id: string | null;
    }>(sql`SELECT matrix_user_id, login_id FROM whatsapp_bridge_accounts
          WHERE id = ${current.id} FOR UPDATE`);
    await query(sql`UPDATE whatsapp_bridge_drafts SET status = 'cancelled'
          WHERE account_id = ${current.id} AND status IN ('draft', 'authorized', 'queued')`);
    await query(sql`UPDATE whatsapp_bridge_shares SET revoked_at = clock_timestamp()
          WHERE revoked_at IS NULL AND chat_id IN (
            SELECT id FROM whatsapp_bridge_chats WHERE account_id = ${current.id}
          )`);
    await query(sql`UPDATE whatsapp_bridge_chats SET revoked_at = clock_timestamp()
          WHERE account_id = ${current.id} AND revoked_at IS NULL`);
    await query(sql`UPDATE whatsapp_bridge_accounts
          SET status = 'revoked', revoked_at = clock_timestamp(), pairing_nonce_hash = 'revoked'
          WHERE id = ${current.id}`);
    return rows[0];
  });
  if (account?.matrix_user_id)
    await logoutWhatsApp(account.matrix_user_id, account.login_id).catch(() =>
      Promise.resolve()
    );
  return {
    revoked: true as const,
  };
};
const requirePersonalOwner = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor, true);
  if (access.organizationId) throw new WorkspaceAccessDenied();
  return {
    ...access,
    userId: actor.userId,
  };
};
const requireAccount = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  manage: boolean
) {
  if (manage) await requirePersonalOwner(actor);
  else await requireWorkspaceAccess(actor);
  const rows = await query<{
    id: string;
    status: string;
  }>(sql`SELECT id, status FROM whatsapp_bridge_accounts
    WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL
      AND status IN ('connected', 'paused') FOR UPDATE`);
  const account = rows[0];
  if (!account) throw new WorkspaceAccessDenied();
  return account;
};
const requireOwnedChat = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  chatId: string
) {
  const account = await requireAccount(actor, true);
  const rows = await query<{
    id: string;
    account_id: string;
    kind: string;
  }>(sql`SELECT id, account_id, kind FROM whatsapp_bridge_chats
    WHERE id = ${chatId} AND account_id = ${account.id} AND revoked_at IS NULL`);
  const chat = rows[0];
  if (!chat) throw new WorkspaceAccessDenied();
  return {
    accountId: chat.account_id,
    id: chat.id,
    kind: chat.kind,
  };
};
const requireVisibleChat = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  chatId: string
) {
  const chats = await listWhatsAppChats(actor);
  const chat = chats.find((item) => item.handle === chatId);
  if (!chat) throw new WorkspaceAccessDenied();
  return {
    id: chat.handle,
  };
};
const setAccountStatus = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  from: "connected" | "paused",
  to: "connected" | "paused"
) {
  return await withDatabaseTransaction(async () => {
    const account = await requireAccount(actor, true);
    if (account.status !== from) throw new WorkspaceAccessDenied();
    const updated =
      to === "paused"
        ? await query(sql`UPDATE whatsapp_bridge_accounts
              SET status = 'paused', paused_at = clock_timestamp()
              WHERE id = ${account.id} AND status = 'connected' RETURNING id`)
        : await query(sql`UPDATE whatsapp_bridge_accounts
              SET status = 'connected', paused_at = NULL
              WHERE id = ${account.id} AND status = 'paused' RETURNING id`);
    if (!updated.length) throw new WorkspaceAccessDenied();
    return {
      status: to,
    };
  });
};
const insertWhatsAppEvent = async function (input: {
  accountId: string;
  chatId: string;
  providerEventId: string;
  matrixEventId: string | null;
  kind: "backfill" | "live";
  authorRemoteId: string;
  body: string;
  alert: boolean;
}) {
  const existing = await query<{
    id: string;
  }>(sql`SELECT id FROM whatsapp_bridge_events
      WHERE account_id = ${input.accountId} AND provider_event_id = ${input.providerEventId}`);
  if (existing[0])
    return {
      id: existing[0].id,
      duplicate: true,
      alert: false,
    };
  const id = randomUUID();
  await query(sql`INSERT INTO whatsapp_bridge_events(
          id, account_id, chat_id, provider_event_id, matrix_event_id, kind, author_remote_id, body, occurred_at
        ) VALUES (
          ${id}, ${input.accountId}, ${input.chatId}, ${input.providerEventId}, ${input.matrixEventId},
          ${input.kind}, ${input.authorRemoteId}, ${input.body}, clock_timestamp()
        )`);
  if (input.kind === "backfill")
    await query(sql`UPDATE whatsapp_bridge_chats SET last_backfill_at = clock_timestamp()
          WHERE id = ${input.chatId}`);
  if (input.kind === "live")
    await query(sql`UPDATE whatsapp_bridge_chats SET last_live_at = clock_timestamp()
          WHERE id = ${input.chatId}`);
  return {
    id,
    duplicate: false,
    alert: input.alert,
  };
};
const completePairingFromBridge = async function (
  accountId: string,
  matrixUserId: string
) {
  const whoami = await whoamiWhatsApp(matrixUserId);
  if (!whoami.loggedIn || !whoami.remoteUserId) return false;
  await completeConnectedAccount(
    accountId,
    whoami.remoteUserId,
    matrixUserId,
    whoami.loginId
  );
  return true;
};
const completeConnectedAccount = async function (
  accountId: string,
  remoteUserId: string,
  matrixUserId: string,
  loginId: string | null
) {
  const updated = await Promise.try(async () =>
    query(sql`UPDATE whatsapp_bridge_accounts
            SET status = 'connected', remote_user_id = ${remoteUserId},
              matrix_user_id = ${matrixUserId}, login_id = ${loginId},
              connected_at = clock_timestamp()
            WHERE id = ${accountId} AND status = 'pairing' AND revoked_at IS NULL
            RETURNING id`)
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  if (!updated.length) throw new WorkspaceAccessDenied();
  return updated[0];
};
const startBridgeLogin = async function (
  accountId: string,
  matrixUserId: string | null
) {
  if (!matrixUserId)
    return {
      loginId: null,
      qr: null,
    };
  const started = await Promise.try(async () =>
    startWhatsAppLogin(matrixUserId)
  ).catch(() => Promise.resolve(null));
  if (!started)
    return {
      loginId: null,
      qr: null,
    };
  await query(sql`UPDATE whatsapp_bridge_accounts SET login_id = ${started.loginId}
    WHERE id = ${accountId}`);
  return {
    loginId: started.loginId,
    qr: started.qr,
  };
};
const resolvePairingMatrixUserId = async function (userId: string) {
  const rows = await query<{
    matrix_id: string;
  }>(sql`SELECT matrix_id FROM matrix_identities WHERE user_id = ${userId}`);
  if (rows[0]) return rows[0].matrix_id;
  if (!env.ZOEN_MATRIX_SERVER_NAME) return null;
  return `@_zoen_wa_${userId
    .replace(/[^a-z0-9]/gi, "")
    .slice(-32)
    .toLowerCase()}:${env.ZOEN_MATRIX_SERVER_NAME}`;
};
function puppetUserId(remoteUserId: string) {
  const localpart = remoteUserId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `@whatsapp_${localpart}:${env.ZOEN_MATRIX_SERVER_NAME ?? "zoen.invalid"}`;
}
function hashNonce(nonce: string) {
  return createHash("sha256").update(nonce).digest("hex");
}
