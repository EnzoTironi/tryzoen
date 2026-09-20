import { z } from "zod";

import type { ChannelSendOptions } from "eve/channels";
import type { Identity } from "../accounts";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { groupSessionMemoryAttributes } from "../personal-memory/group-memory-policy";
import { groupConversationMatchesIdentity } from "./group-policy";
import { ChannelTransport } from "./transport";

export class ChannelDispatchError extends Error {
  readonly _tag = "ChannelDispatchError";
  declare readonly reason:
    | "unauthorized"
    | "handoff_unknown"
    | "unsupported_media";
  constructor(input: {
    readonly reason: "unauthorized" | "handoff_unknown" | "unsupported_media";
  }) {
    super("ChannelDispatchError");
    this.name = "ChannelDispatchError";
    Object.assign(this, input);
  }
}

export const channelPrincipal = (
  identity: Identity,
  sourceMessageId?: string,
  group?: {
    readonly conversationScope: string;
    readonly chatKind: "group";
    readonly chatId: string;
  }
) => {
  const principalId = `better-auth:${identity.userId}`;
  const workspaceId = accessScopeForUser(principalId).workspaceId;
  const attributes = group
    ? {
        channelIdentityId: identity.id,
        conversationChannel: identity.channel,
        conversationId: group.conversationScope,
        workspaceId,
        ...groupSessionMemoryAttributes(group),
      }
    : {
        channelIdentityId: identity.id,
        conversationChannel: identity.channel,
        conversationId: identity.id,
        workspaceId,
      };
  const principal = {
    attributes,
    authenticator: "verified-channel",
    principalId,
    principalType: "user",
  };
  if (!sourceMessageId) return principal;
  return { ...principal, attributes: { ...attributes, sourceMessageId } };
};

export const requireChannelPrincipal = async function (
  channel: Identity["channel"],
  auth: ChannelSendOptions["auth"]
) {
  if (!auth) throw new ChannelDispatchError({ reason: "unauthorized" });
  const identityId = await Promise.try(async () =>
    z.uuid().parseAsync(auth.attributes.channelIdentityId)
  ).catch(() => {
    throw new ChannelDispatchError({ reason: "unauthorized" });
  });
  const transport = ChannelTransport;
  const identity = await transport.activeIdentity(identityId, channel);
  const expected = channelPrincipal(identity);
  const conversationId = ((parsed) =>
    parsed.success ? parsed.data : undefined)(
    z.string().safeParse(auth.attributes.conversationId)
  );
  const conversationOk =
    conversationId === identity.id ||
    (conversationId !== undefined &&
      groupConversationMatchesIdentity(conversationId, identity));
  if (
    auth.principalType !== "user" ||
    auth.principalId !== expected.principalId ||
    auth.attributes.workspaceId !== expected.attributes.workspaceId ||
    auth.attributes.conversationChannel !== channel ||
    !conversationOk
  )
    throw new ChannelDispatchError({ reason: "unauthorized" });
  return identity;
};
