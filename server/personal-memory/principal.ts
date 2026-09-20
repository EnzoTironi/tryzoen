import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { SqlError } from "../../db/queries";
import { isValid } from "@shared/validation";
import { z } from "zod";

import type { SessionAuthContext } from "eve/context";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import { scopeFromPrincipal } from "../../shared/identity/principal-scope";
import { requireChannelPrincipal } from "../channels/principal";
import {
  PersonalMemoryError,
  requirePersonalMemoryMembership,
  requirePersonalMemoryWebSession,
} from "./access";

// Storage callers keep these authority locks in the same transaction as document I/O.
export const authorizePersonalMemoryPrincipal = async function (
  principal: SessionAuthContext | null
) {
  try {
    if (principal?.principalType !== "user")
      throw new PersonalMemoryError({ reason: "unauthenticated" });
    const scope = await Promise.try(async () =>
      scopeFromPrincipal(principal)
    ).catch(() => {
      throw new PersonalMemoryError({ reason: "unauthenticated" });
    });
    if (
      principal.authenticator === "verified-channel" ||
      isValid(channelProviderSchema, principal.attributes.conversationChannel)
    ) {
      const channel = await Promise.try(async () =>
        channelProviderSchema.parseAsync(
          principal.attributes.conversationChannel
        )
      ).catch(() => {
        throw new PersonalMemoryError({ reason: "unauthenticated" });
      });
      const identity = await Promise.try(async () =>
        requireChannelPrincipal(channel, principal)
      ).catch(() => {
        throw new PersonalMemoryError({ reason: "unauthenticated" });
      });

      const rows = await query(
        sql`SELECT id FROM channel_identity WHERE id = ${identity.id} AND revoked_at IS NULL FOR SHARE`
      );
      if (rows.length !== 1)
        throw new PersonalMemoryError({ reason: "unauthenticated" });
    }
    if (principal.authenticator === "authjs") {
      const sessionId = await Promise.try(async () =>
        z.string().min(1).parseAsync(principal.attributes.authSessionId)
      ).catch(() => {
        throw new PersonalMemoryError({ reason: "unauthenticated" });
      });
      await requirePersonalMemoryWebSession(scope, sessionId);
    } else await requirePersonalMemoryMembership(scope);
    return scope;
  } catch (error) {
    if (error instanceof SqlError) {
      throw new PersonalMemoryError({ reason: "unavailable" });
    }
    throw error;
  }
};
