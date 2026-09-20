import { sleep } from "../operations/async";
import { expect, test } from "vitest";
import { ChannelAuthPromptError } from "../channel-auth/prompts";
import { dispatchItem } from "./dispatch";

test("an expired item does not interrupt an already running sibling", async () => {
  const started = Promise.withResolvers<void>();
  let completed = false;
  const healthy = (async () => {
    started.resolve();
    await sleep(10);
    completed = true;
  })();
  const expired = (async () => {
    await started.promise;
    throw new ChannelAuthPromptError({ reason: "lease_lost" });
  })();
  await Promise.all([
    dispatchItem("expired-prompt", expired),
    dispatchItem("healthy-identity", healthy),
  ]);
  expect(completed).toBe(true);
});
