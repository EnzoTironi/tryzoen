import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { roomMemberSchema } from "@zoen/companion-ui/rooms";
import { documentMarkdown } from "@zoen/companion-ui/markdown";
import { UsernameSchema } from "../accounts/directory";
import type { WorkspaceActorSchema } from "../workspaces/access";
import type { joinMatrixRoom } from "./rooms";
import { directRoomMembers } from "./direct";
import { matrixConfiguration } from "./client";

/** Resolve authored @usernames only within the already-authorized room. */
export async function resolveMatrixMentions(
  actor: z.infer<typeof WorkspaceActorSchema>,
  room: Awaited<ReturnType<typeof joinMatrixRoom>>,
  text: string
) {
  const usernames = mentionedUsernames(text);
  if (!usernames.size) return { user_ids: [] };
  if (room.kind === "direct") {
    const members = await directRoomMembers(actor, room.id);
    return { user_ids: exactMentionIds(members, usernames, room.matrixId) };
  }
  const config = await matrixConfiguration();
  const userIds = usernames.delete("zoen") ? [config.botId] : [];
  if (usernames.size) {
    const names = sql.join(
      [...usernames].map((name) => sql`${name}`),
      sql`, `
    );
    const candidateSchema = z.array(
      roomMemberSchema.pick({ id: true }).extend({ username: UsernameSchema })
    );
    const humans = candidateSchema.parse(
      await query(sql`
      SELECT i.matrix_id AS id, d.username FROM matrix_room_members m
      JOIN workspace_group_bindings b ON b.id = m.binding_id
      JOIN matrix_identities i ON i.user_id = m.user_id
      JOIN workspace_memberships w ON w.workspace_id = b.workspace_id AND w.user_id = m.user_id
      JOIN workspaces s ON s.id = w.workspace_id
      JOIN organization_memberships o ON o.organization_id = s.organization_id AND o.user_id = m.user_id
      JOIN user_directory d ON ('better-auth:' || d.user_id) = m.user_id
      WHERE m.binding_id = ${room.id} AND m.state = 'joined'
        AND b.workspace_id = ${actor.workspaceId} AND b.conversation_id = ${room.roomId}
        AND b.channel = 'matrix' AND b.installation_id = ${config.serverName} AND b.revoked_at IS NULL
        AND d.username IN (${names})
      ORDER BY i.matrix_id FOR SHARE OF m, b, i, w, s, o, d`)
    );
    const agents = candidateSchema.parse(
      await query(sql`
      SELECT i.matrix_id AS id, a.username FROM workspace_agent_members a
      JOIN matrix_identities i ON i.user_id = ('agent:' || a.id::text)
      JOIN matrix_room_members m ON m.user_id = i.user_id
      JOIN workspace_group_bindings b ON b.id = m.binding_id
      WHERE m.binding_id = ${room.id} AND m.state = 'joined' AND a.revoked_at IS NULL
        AND a.workspace_id = ${actor.workspaceId} AND b.workspace_id = a.workspace_id
        AND b.conversation_id = ${room.roomId} AND b.channel = 'matrix'
        AND b.installation_id = ${config.serverName} AND b.revoked_at IS NULL
        AND a.username IN (${names})
      ORDER BY i.matrix_id FOR SHARE OF a, i, m, b`)
    );
    userIds.push(
      ...exactMentionIds([...humans, ...agents], usernames, room.matrixId)
    );
  }
  return { user_ids: userIds.toSorted() };
}

function exactMentionIds(
  members: Pick<z.infer<typeof roomMemberSchema>, "id" | "username">[],
  usernames: Set<string>,
  viewerId: string
) {
  const identities = new Map<string, Set<string>>();
  for (const member of members) {
    if (!member.username || !usernames.has(member.username)) continue;
    const ids = identities.get(member.username) ?? new Set<string>();
    ids.add(member.id);
    identities.set(member.username, ids);
  }
  return [...identities.values()]
    .flatMap((ids) =>
      ids.size === 1 ? [...ids].filter((id) => id !== viewerId) : []
    )
    .toSorted();
}

type MarkdownToken = ReturnType<typeof documentMarkdown.instance.lexer>[number];

function isMarkdownToken<Kind extends MarkdownToken["type"]>(
  token: MarkdownToken,
  kind: Kind
): token is Extract<MarkdownToken, { type: Kind }> {
  return token.type === kind;
}

function mentionedUsernames(text: string) {
  const usernames = new Set<string>();
  function visit(tokens: MarkdownToken[]) {
    for (const token of tokens) {
      if (
        ["blockquote", "code", "codespan", "escape", "html", "image"].includes(
          token.type
        )
      )
        continue;
      // Link labels are authored prose; destinations and automatic URL labels are not.
      if (token.type === "link" && !token.raw.startsWith("[")) continue;
      if (isMarkdownToken(token, "list")) {
        for (const item of token.items) visit(item.tokens);
      } else if (isMarkdownToken(token, "table")) {
        for (const cell of [...token.header, ...token.rows.flat()])
          visit(cell.tokens);
      } else if ("tokens" in token && token.tokens) {
        visit(token.tokens);
      } else if (token.type === "text" && !token.escaped) {
        for (const match of token.raw.matchAll(
          /(?<![\p{L}\p{N}_@])@([a-z][a-z0-9_]*)(?![\p{L}\p{N}_@-]|:[^\s]|\.[\p{L}\p{N}_])/giu
        )) {
          const username = UsernameSchema.safeParse(match[1]?.toLowerCase());
          if (username.success) usernames.add(username.data);
        }
      }
    }
  }
  visit(documentMarkdown.instance.lexer(text));
  return usernames;
}
