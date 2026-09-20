import { z } from "zod";

import { db } from "../../db";
import { PersonalMemoryError } from "../../server/personal-memory/access";
import { inspectPersonalMemory } from "../../server/personal-memory/export";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin)
  chunks.push(Buffer.from(z.instanceof(Uint8Array).parse(chunk)));
const cookie = Buffer.concat(chunks).toString("utf8");
try {
  try {
    const snapshot = await inspectPersonalMemory(new Headers({ cookie }));
    process.stdout.write(JSON.stringify({ status: "Success", snapshot }));
  } catch (error) {
    if (!(error instanceof PersonalMemoryError)) throw error;
    process.stdout.write(
      JSON.stringify({ status: "Failure", reason: error.reason })
    );
  }
} finally {
  await db.$client.end();
}
