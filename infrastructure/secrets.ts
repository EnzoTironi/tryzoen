import { createHash } from "node:crypto";
import * as Machines from "@distilled.cloud/fly-io/machines";
import { adopt } from "alchemy/AdoptPolicy";
import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Config, Effect } from "effect";

export const privatePayloadSecretNames = [
  "ZOEN_PAYLOAD_ENDPOINT",
  "ZOEN_PAYLOAD_BUCKET",
  "ZOEN_PAYLOAD_ACCESS_KEY",
  "ZOEN_PAYLOAD_SECRET_KEY",
  "ZOEN_PAYLOAD_PREFIX",
] as const;

export const erasureJournalSecretNames = [
  "ZOEN_ERASURE_JOURNAL_BUCKET",
  "ZOEN_ERASURE_JOURNAL_ACCESS_KEY",
  "ZOEN_ERASURE_JOURNAL_SECRET_KEY",
] as const;

export const privateStorageSecretNames = [
  ...privatePayloadSecretNames,
  ...erasureJournalSecretNames,
] as const;

/** Reads names and digests only; payload credentials remain in the two Fly vaults. */
export const privateStorageDigests = Effect.fn(function* (
  app: string,
  names: readonly string[]
) {
  const inventory = yield* Machines.listSecrets({
    app_name: app,
    show_secrets: false,
  }).pipe(
    Effect.mapError(
      () =>
        new Error(
          "Private storage secret inventory unavailable; keeping the existing web release."
        )
    )
  );
  return yield* Effect.forEach(names, (name) => {
    const entries = inventory.secrets?.filter((secret) => secret.name === name);
    const digest = entries?.[0]?.digest;
    return entries?.length === 1 && digest?.trim()
      ? Effect.succeed([name, digest] as const)
      : Effect.fail(
          new Error(
            "Required private storage secrets are missing or ambiguous; keeping the existing web release."
          )
        );
  });
});

export const privatePayloadVersion = Effect.fn(function* (
  apps: readonly string[]
) {
  const digests = yield* Effect.forEach(apps, (app) =>
    privateStorageDigests(app, privatePayloadSecretNames)
  );
  return createHash("sha256").update(JSON.stringify(digests)).digest("hex");
});

export const webSecretNames = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "COMPANION_MODEL_PROVIDER",
  "COMPANION_PUBLIC_BASE_URL",
  "WORKFLOW_LOCAL_BASE_URL",
  "TELEGRAM_BOT_ID",
  "TELEGRAM_BOT_USERNAME",
  "MARKETING_IMESSAGE_NUMBER",
  "MARKETING_TELEGRAM_USERNAME",
  "MARKETING_WHATSAPP_NUMBER",
  "SECRET_ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "KAPSO_API_KEY",
  "KAPSO_PHONE_NUMBER_ID",
  "KAPSO_PHONE_NUMBER",
  "KAPSO_WEBHOOK_SECRET",
  "KERNEL_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "CODEX_AUTH_JSON",
] as const;

/** Only vault digests enter Machine metadata; rotations restart the consumer with the new vault values. */
export const appSecrets = Effect.fn(function* (
  id: string,
  app: Fly.App,
  names: readonly string[]
) {
  const entries = yield* Effect.forEach(names, (name) =>
    Effect.gen(function* () {
      const value = yield* Config.redacted(name);
      return yield* Fly.Secret(`${id}${name}`, { app, name, value }).pipe(
        adopt(true),
        RemovalPolicy.retain(true)
      );
    })
  );
  return Output.all(...entries.map((entry) => entry.digest)).pipe(
    Output.map((digests) =>
      createHash("sha256").update(JSON.stringify(digests)).digest("hex")
    )
  );
});
