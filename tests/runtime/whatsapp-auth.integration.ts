import { Secret } from "@shared/environment/secret";
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, name): unknown {
        if (name === "KAPSO_WEBHOOK_SECRET" || name === "KAPSO_API_KEY")
          return new Secret(z.string().min(1).parse(process.env[name]));
        if (typeof name === "string" && name.startsWith("KAPSO_"))
          return process.env[name];
        return Reflect.get(target, name);
      },
    }),
  };
});
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomInt } from "node:crypto";

import type { RouteHandlerArgs } from "eve/channels";
import { test, vi } from "vitest";
import { privateChannel } from "../../agent/lib/private-channel";
import { ChannelAccounts } from "../../server/accounts";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { linkedIdentity } from "./identity-fixture";

test("signed WhatsApp button confirms only its recipient and original browser without running the agent", async () => {
  const installationId = String(randomInt(100_000_000, 999_999_999));
  const senderId = `1555${String(randomInt(1000000, 9999999))}`;
  const secret = randomBytes(32).toString("hex");
  vi.stubEnv("KAPSO_PHONE_NUMBER_ID", installationId);
  vi.stubEnv("KAPSO_PHONE_NUMBER", "+15550001111");
  vi.stubEnv("KAPSO_API_KEY", "synthetic-kapso-key");
  vi.stubEnv("KAPSO_WEBHOOK_SECRET", secret);
  const bodySchema = z.object({
    to: z.string(),
    type: z.enum(["text", "interactive"]),
    interactive: z.optional(
      z.object({
        type: z.literal("button"),
        action: z.object({
          buttons: z.array(
            z.object({
              type: z.literal("reply"),
              reply: z.object({ id: z.string(), title: z.string() }),
            })
          ),
        }),
      })
    ),
  });
  const sent: z.output<typeof bodySchema>[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      assert.equal(
        request.url,
        `https://api.kapso.ai/meta/whatsapp/v24.0/${installationId}/messages`
      );
      const body = bodySchema.parse(await request.json());
      sent.push(body);
      return Response.json({
        messaging_product: "whatsapp",
        contacts: [{ input: body.to, wa_id: body.to }],
        messages: [{ id: `wamid.out-${String(sent.length)}` }],
      });
    }
  );
  const browserSecret = randomBytes(32).toString("base64url");
  const sender = { channel: "kapso" as const, installationId, senderId };
  const setup = await (async function () {
    const [database] = await query<{
      name: string;
    }>(sql`SELECT current_database() AS name`);
    assert.equal(database?.name, "companion_runtime_test");
    const accounts = ChannelAccounts;
    const identity = await linkedIdentity(sender);
    const challenge = await accounts.issueChallenge({
      ...sender,
      purpose: "login",
      browserSecret,
    });
    return { identity, challenge };
  })();
  const route = privateChannel("kapso").routes[0];
  assert.ok(route && route.transport !== "websocket");
  const background: Promise<unknown>[] = [];
  const context: RouteHandlerArgs = {
    from: () => assert.fail("Device authentication cannot start agent turns"),
    resolveSession: () =>
      assert.fail("Device authentication cannot resolve agent sessions"),
    attachSession: () =>
      assert.fail("Device authentication cannot attach agent sessions"),
    to: () => assert.fail("Device authentication cannot send agent messages"),
    params: {},
    requestIp: null,
    waitUntil: (task) => {
      background.push(task);
    },
  };
  const deliver = async (
    id: string,
    confirm = false,
    from = senderId,
    signingSecret = secret,
    origin = "cloud_api"
  ) => {
    const body = JSON.stringify({
      phone_number_id: installationId,
      conversation: { phone_number_id: installationId, phone_number: from },
      message: {
        id: `wamid.${id}`,
        from,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: confirm ? "interactive" : "text",
        text: { body: `/start ${setup.challenge.token}` },
        interactive: {
          type: "button_reply",
          button_reply: { id: `confirm:${setup.challenge.token}` },
        },
        kapso: { direction: "inbound", status: "received", origin },
      },
    });
    const response = await route.handler(
      new Request("http://localhost/channels/kapso", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": createHmac("sha256", signingSecret)
            .update(body)
            .digest("hex"),
        },
      }),
      context
    );
    await Promise.all(background);
    return response;
  };
  const status = () =>
    Promise.try(async () => ChannelAccounts).then((accounts) =>
      accounts.getChallengeStatus({
        challengeId: setup.challenge.challengeId,
        browserSecret,
      })
    );
  try {
    assert.equal((await deliver("start")).status, 200);
    assert.equal((await deliver("start")).status, 200);
    assert.equal(
      sent.filter((message) => message.type === "interactive").length,
      1
    );
    assert.deepEqual(sent[0]?.interactive?.action.buttons, [
      {
        type: "reply",
        reply: {
          id: `confirm:${setup.challenge.token}`,
          title: "Confirmar entrada",
        },
      },
    ]);
    assert.equal(sent[0].to, senderId);
    assert.deepEqual(await status(), { status: "pending" });
    assert.equal(
      (await deliver("forged", true, senderId, "wrong-secret")).status,
      401
    );
    assert.equal(
      (await deliver("history", true, senderId, secret, "history_sync")).status,
      200
    );
    assert.equal((await deliver("forwarded", true, "15550003333")).status, 200);
    assert.deepEqual(await status(), { status: "pending" });
    assert.equal((await deliver("confirm", true)).status, 200);
    assert.deepEqual(await status(), { status: "confirmed" });
    await (async function () {
      const accounts = ChannelAccounts;
      const wrongBrowser = await Promise.try(async () =>
        accounts.consumeChallenge({
          challengeId: setup.challenge.challengeId,
          browserSecret: "a-different-browser",
        })
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      );
      assert.equal(!wrongBrowser.ok, true);
      const owner = await accounts.consumeChallenge({
        challengeId: setup.challenge.challengeId,
        browserSecret,
      });
      assert.equal(owner.userId, setup.identity.userId);
    })();
    assert.equal((await deliver("replay", true)).status, 200);
    assert.deepEqual(await status(), { status: "consumed" });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await (async function () {
      await query(
        sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`
      );
      await query(
        sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`
      );
      await query(
        sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${setup.identity.userId}`).workspaceId}`
      );
      await query(
        sql`DELETE FROM public.user WHERE id = ${setup.identity.userId}`
      );
    })();
  }
});
