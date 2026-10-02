import * as Fly from "alchemy/Fly";
import * as Output from "alchemy/Output";
import { Action } from "alchemy/Action";
import { adopt } from "alchemy/AdoptPolicy";
import { Random } from "alchemy/Random";
import { retain } from "alchemy/RemovalPolicy";
import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { Effect, Schedule } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { releaseImage } from "./images.ts";
import { production } from "./production.ts";

const VerifySemantic = Action(
  "Zoen.VerifySemantic",
  (input: {
    app: string;
    machine: string;
    image: string;
    url: string;
    version: string;
  }) =>
    Effect.gen(function* () {
      const result = yield* Machines.execMachine({
        app_name: input.app,
        machine_id: input.machine,
        command: ["node", "/semantic/probe.mjs", input.url],
        timeout: 60,
      });
      if (result.exit_code !== 0)
        return yield* Effect.fail(
          new Error("Semantic production probe failed")
        );
      return { url: input.url, image: input.image, version: input.version };
    }).pipe(
      Effect.retry({ times: 4, schedule: Schedule.spaced("3 seconds") }),
      Effect.provide(CredentialsFromEnv),
      Effect.provide(FetchHttpClient.layer)
    )
);

export const deploySemantic = Effect.fn("deploySemantic")(function* (input: {
  stage: string;
  webApp: Fly.App;
}) {
  const name =
    input.stage === "prod"
      ? production.semantic.app
      : `zoen-semantic-${input.stage}`;
  const app = yield* Fly.App("SemanticApp", {
    name,
    orgSlug: production.organization,
  }).pipe(adopt(input.stage === "prod"), retain(true));
  const token = yield* Random("SemanticToken", { bytes: 32 }).pipe(
    retain(true)
  );
  const secret = yield* Fly.Secret("SemanticTokenSecret", {
    app,
    name: "ZOEN_SEMANTIC_TOKEN",
    value: token.text,
  }).pipe(retain(true));
  const webSecret = yield* Fly.Secret("WebSemanticToken", {
    app: input.webApp,
    name: "ZOEN_SEMANTIC_TOKEN",
    value: token.text,
  }).pipe(retain(true));
  const image = yield* releaseImage(
    "Semantic",
    app.appName,
    "..",
    "infrastructure/semantic/Dockerfile.fly"
  );
  const machine = yield* Fly.Machine("Semantic", {
    app,
    name: "semantic",
    region: production.region,
    count: 1,
    image,
    guest: { cpuKind: "shared", cpus: 1, memoryMb: 2048 },
    env: { NODE_ENV: "production", ZOEN_SEMANTIC_PORT: "18130" },
    services: [
      {
        protocol: "tcp",
        internalPort: 18130,
        autostop: "off",
        autostart: true,
        minMachinesRunning: 1,
        ports: [{ port: 443, handlers: ["http", "tls"] }],
      },
    ],
    checks: {
      ready: {
        type: "tcp",
        port: 18130,
        interval: "15s",
        timeout: "5s",
        grace_period: "30s",
      },
    },
    restart: { policy: "always" },
    metadata: {
      "zoen.secrets": secret.digest.pipe(Output.map((value) => value ?? "")),
    },
  }).pipe(retain(true));
  const ip = yield* Fly.IpAssignment("SemanticIpv4", {
    app,
    type: "shared_v4",
  }).pipe(retain(true));
  return yield* VerifySemantic({
    app: name,
    machine: machine.machineId,
    image,
    url: ip.ip.pipe(Output.map(() => `https://${name}.fly.dev/`)),
    version: webSecret.digest.pipe(Output.map((value) => value ?? "")),
  });
});
