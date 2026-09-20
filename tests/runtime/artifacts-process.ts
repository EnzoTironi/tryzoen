import { db } from "@db/index";
import { jsonString } from "@shared/validation";
import { z } from "zod";

import { Artifacts } from "../../server/artifacts";
import {
  ArtifactAccessSchema,
  ArtifactSourceSchema,
} from "../../server/artifacts/model";

const operation = z.enum(["put", "read"]).parse(process.argv[2]);
const raw = process.argv[3];
try {
  const result = await (async function () {
    const artifacts = Artifacts;
    if (operation === "put") {
      const input = await jsonString(ArtifactSourceSchema).parseAsync(raw);
      const metadata = await artifacts.put({
        ...input,
        bytes: Buffer.from("stored before writer process exited"),
      });
      return {
        artifactId: metadata.artifactId,
        sha256: metadata.sha256,
        text: "",
      };
    }
    const input = await jsonString(ArtifactAccessSchema).parseAsync(raw);
    const stored = await artifacts.read(input);
    return {
      artifactId: stored.metadata.artifactId,
      sha256: stored.metadata.sha256,
      text: Buffer.from(stored.bytes).toString("utf8"),
    };
  })();
  process.stdout.write(JSON.stringify(result));
} finally {
  await db.$client.end();
}
