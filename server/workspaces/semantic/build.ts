import { PGlite } from "@electric-sql/pglite";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Native CJS keeps the PGlite WASM loader's asset paths local to this package.
const require = createRequire(import.meta.url);
const pglite = require.resolve("@electric-sql/pglite");
const output = ".output/server/semantic";
await mkdir(output, { recursive: true });
// Build one empty, credential-free database. Every query restores its own copy,
// avoiding repeated initdb instances and WASM compilation in the execution limit.
const database = new PGlite({
  postgresqlconf: [
    "shared_buffers = '16MB'",
    "work_mem = '4MB'",
    "maintenance_work_mem = '16MB'",
    "temp_buffers = '1MB'",
  ],
});
try {
  const archive = await database.dumpDataDir("gzip");
  await writeFile(
    join(output, "empty-database.tgz"),
    new Uint8Array(await archive.arrayBuffer())
  );
} finally {
  await database.close();
}
await build({
  entryPoints: ["server/workspaces/semantic/worker.ts"],
  outfile: join(output, "worker.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  alias: { "@electric-sql/pglite": pglite },
  // The network adapter's optional native driver is unreachable in the snapshot.
  external: ["pg-native"],
  legalComments: "linked",
});
for (const file of ["pglite.wasm", "pglite.data"])
  await copyFile(join(dirname(pglite), file), join(output, file));

await build({
  entryPoints: ["server/workspaces/semantic/service.ts"],
  outfile: join(output, "service.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  legalComments: "linked",
});
