import { randomUUID } from "node:crypto";

import { justbash } from "eve/sandbox/just-bash";
import { expect, test } from "vitest";

test("the real Eve virtual shell keeps files session-private and excludes host files and credentials", async ({
  onTestFinished,
}) => {
  const backend = justbash({ autoInstall: false });
  const first = await backend.create({
    templateKey: null,
    sessionKey: randomUUID(),
    runtimeContext: { appRoot: process.cwd() },
  });
  onTestFinished(() => first.delete());
  const second = await backend.create({
    templateKey: null,
    sessionKey: randomUUID(),
    runtimeContext: { appRoot: process.cwd() },
  });
  onTestFinished(() => second.delete());
  await first.session.writeTextFile({
    path: "private.txt",
    content: "Synthetic private note",
  });
  expect(await first.session.readTextFile({ path: "private.txt" })).toContain(
    "Synthetic private note"
  );
  expect(
    (await second.session.run({ command: "cat private.txt" })).exitCode
  ).not.toBe(0);
  const host = await first.session.run({
    command: "cat /etc/hosts; printenv DATABASE_URL",
  });
  expect(host.stdout).not.toContain("postgresql:");
  expect(host.stdout).not.toContain("localhost");
}, 15000);
