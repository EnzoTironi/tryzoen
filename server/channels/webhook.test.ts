import { WebhookRejected } from "./webhook";
import { Secret } from "@shared/environment/secret";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readVerifiedWebhook } from "./webhook";

const testSecret = new Secret("unit-test-webhook-secret");

describe("webhook byte and authentication boundaries", () => {
  it("rejects Telegram before reading an unauthenticated body", async () => {
    const request = new Request("https://test.invalid/channels/telegram", {
      method: "POST",
      body: "not json",
    });
    const result = await Promise.try(async () =>
      readVerifiedWebhook(request, "telegram", testSecret)
    ).then(
      () => {
        throw new Error("Expected rejection");
      },
      (error: unknown) => {
        if (error instanceof WebhookRejected) return error;
        throw error;
      }
    );
    expect(result.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  it.each(["telegram", "kapso"] as const)(
    "does not accept an empty %s configured secret",
    async (channel) => {
      const request = new Request("https://test.invalid/channels/telegram", {
        method: "POST",
        body: "{}",
        headers: {
          "x-webhook-signature": createHmac("sha256", "")
            .update("{}")
            .digest("hex"),
        },
      });
      const result = await Promise.try(async () =>
        readVerifiedWebhook(request, channel, new Secret(""))
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof WebhookRejected) return error;
          throw error;
        }
      );
      expect(result.status).toBe(401);
    }
  );

  it("bounds timeout cleanup even when stream cancellation never settles", async () => {
    let cancellationRequested = false;
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<never>(() => undefined),
      cancel: () => {
        cancellationRequested = true;
        return new Promise<never>(() => undefined);
      },
    });
    const options = {
      method: "POST",
      body,
      duplex: "half",
      headers: {
        "x-telegram-bot-api-secret-token": testSecret.reveal(),
      },
    };
    const started = performance.now();
    const result = await Promise.try(async () =>
      readVerifiedWebhook(
        new Request("https://test.invalid/channels/telegram", options),
        "telegram",
        testSecret
      )
    ).then(
      () => {
        throw new Error("Expected rejection");
      },
      (error: unknown) => {
        if (error instanceof WebhookRejected) return error;
        throw error;
      }
    );
    expect(result.status).toBe(408);
    expect(cancellationRequested).toBe(true);
    expect(performance.now() - started).toBeLessThan(6000);
    expect(body.locked).toBe(false);
  }, 7000);

  it("verifies Kapso over the original bytes, including whitespace", async () => {
    const body = '{ "message": { "text": "Olá" } }';
    const signature = createHmac("sha256", testSecret.reveal())
      .update(body)
      .digest("hex");
    const request = new Request("https://test.invalid/channels/kapso", {
      method: "POST",
      body,
      headers: { "x-webhook-signature": signature },
    });
    expect(await readVerifiedWebhook(request, "kapso", testSecret)).toEqual({
      message: { text: "Olá" },
    });
    const changed = new Request("https://test.invalid/channels/kapso", {
      method: "POST",
      body: '{"message":{"text":"Olá"}}',
      headers: { "x-webhook-signature": signature },
    });
    expect(
      await Promise.try(async () =>
        readVerifiedWebhook(changed, "kapso", testSecret)
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof WebhookRejected) return error;
          throw error;
        }
      )
    ).toMatchObject({ status: 401 });
  });

  it("rejects oversized bodies without relying on Content-Length", async () => {
    const request = new Request("https://test.invalid/channels/telegram", {
      method: "POST",
      body: "x".repeat(256 * 1024 + 1),
      headers: {
        "x-telegram-bot-api-secret-token": testSecret.reveal(),
      },
    });
    expect(
      await Promise.try(async () =>
        readVerifiedWebhook(request, "telegram", testSecret)
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof WebhookRejected) return error;
          throw error;
        }
      )
    ).toMatchObject({ status: 413 });
  });

  it("reports authenticated malformed JSON as a bad request", async () => {
    const request = new Request("https://test.invalid/channels/telegram", {
      method: "POST",
      body: "{",
      headers: {
        "x-telegram-bot-api-secret-token": testSecret.reveal(),
      },
    });
    expect(
      await Promise.try(async () =>
        readVerifiedWebhook(request, "telegram", testSecret)
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof WebhookRejected) return error;
          throw error;
        }
      )
    ).toMatchObject({ status: 400 });
  });

  it("accepts Telegram secret-token auth for a private chat JSON body", async () => {
    const body = JSON.stringify({
      update_id: 42,
      message: {
        message_id: 7,
        date: 1_800_000_000,
        from: { id: 789012, is_bot: false },
        chat: { id: 789012, type: "private" },
        text: "hello private",
      },
    });
    const request = new Request("https://test.invalid/channels/telegram", {
      method: "POST",
      body,
      headers: {
        "x-telegram-bot-api-secret-token": testSecret.reveal(),
      },
    });
    expect(
      await readVerifiedWebhook(request, "telegram", testSecret)
    ).toMatchObject({
      update_id: 42,
      message: {
        chat: { type: "private" },
        text: "hello private",
      },
    });
  });

  it("rejects a wrong Telegram secret-token before reading the body", async () => {
    const request = new Request("https://test.invalid/channels/telegram", {
      method: "POST",
      body: '{"update_id":1}',
      headers: {
        "x-telegram-bot-api-secret-token": "not-the-configured-secret",
      },
    });
    const result = await Promise.try(async () =>
      readVerifiedWebhook(request, "telegram", testSecret)
    ).then(
      () => {
        throw new Error("Expected rejection");
      },
      (error: unknown) => {
        if (error instanceof WebhookRejected) return error;
        throw error;
      }
    );
    expect(result.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects a length-mismatched Telegram secret-token", async () => {
    const request = new Request("https://test.invalid/channels/telegram", {
      method: "POST",
      body: "{}",
      headers: {
        "x-telegram-bot-api-secret-token": `${testSecret.reveal()}x`,
      },
    });
    expect(
      await Promise.try(async () =>
        readVerifiedWebhook(request, "telegram", testSecret)
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof WebhookRejected) return error;
          throw error;
        }
      )
    ).toMatchObject({ status: 401 });
  });
  it("rejects a wrong Kapso HMAC signature after reading the body", async () => {
    const body = '{ "message": { "text": "Olá" } }';
    const request = new Request("https://test.invalid/channels/kapso", {
      method: "POST",
      body,
      headers: {
        "x-webhook-signature": createHmac("sha256", "other-secret")
          .update(body)
          .digest("hex"),
      },
    });
    const result = await Promise.try(async () =>
      readVerifiedWebhook(request, "kapso", testSecret)
    ).then(
      () => {
        throw new Error("Expected rejection");
      },
      (error: unknown) => {
        if (error instanceof WebhookRejected) return error;
        throw error;
      }
    );
    expect(result.status).toBe(401);
    expect(request.bodyUsed).toBe(true);
  });

  it("rejects a length-mismatched Kapso HMAC signature", async () => {
    const body = "{}";
    const signature = createHmac("sha256", testSecret.reveal())
      .update(body)
      .digest("hex");
    const request = new Request("https://test.invalid/channels/kapso", {
      method: "POST",
      body,
      headers: { "x-webhook-signature": `${signature}00` },
    });
    expect(
      await Promise.try(async () =>
        readVerifiedWebhook(request, "kapso", testSecret)
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof WebhookRejected) return error;
          throw error;
        }
      )
    ).toMatchObject({ status: 401 });
  });

  it("accepts Kapso HMAC auth for a private inbound JSON body", async () => {
    const body = JSON.stringify({
      phone_number_id: "123456789",
      message: {
        id: "wamid.hello",
        timestamp: "1800000000",
        type: "text",
        from: "15550002222",
        text: { body: "hello private" },
        kapso: {
          direction: "inbound",
          status: "received",
          origin: "cloud_api",
        },
      },
      conversation: {
        phone_number_id: "123456789",
        phone_number: "+15550002222",
      },
    });
    const signature = createHmac("sha256", testSecret.reveal())
      .update(body)
      .digest("hex");
    const request = new Request("https://test.invalid/channels/kapso", {
      method: "POST",
      body,
      headers: { "x-webhook-signature": signature },
    });
    expect(
      await readVerifiedWebhook(request, "kapso", testSecret)
    ).toMatchObject({
      phone_number_id: "123456789",
      message: {
        text: { body: "hello private" },
        kapso: { direction: "inbound" },
      },
    });
  });
});
