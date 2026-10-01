import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import type { ClientConfig } from "pg";
import { postgresEndpointSchema } from "@zoen/companion-ui/workspace-sources";
import { publicAddress } from "../../connectors/public-fetch";
import {
  operationSignal,
  withSignal,
  withTimeout,
} from "../../operations/async";

/** Caller must authorize/admit before DNS. No PostgreSQL connection is opened.
 * Native DNS lookup cannot be interrupted. An inherited strict deadline awaits
 * lookup settlement; the post-lookup signal check rejects late answers.
 * Outside that scope, established timeout/cancellation semantics apply.
 */
export async function resolvePostgresEndpoint(
  rawEndpoint: unknown,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const endpoint = postgresEndpointSchema.parse(rawEndpoint);
  return withSignal(signal, () =>
    withTimeout(async () => {
      operationSignal().throwIfAborted();
      const family = isIP(endpoint.host);
      const addresses = family
        ? [{ address: endpoint.host, family }]
        : await lookup(endpoint.host, { all: true, order: "verbatim" });
      operationSignal().throwIfAborted();
      const address = addresses[0]?.address;
      if (!address || addresses.some((entry) => !publicAddress(entry.address)))
        throw new Error("PostgreSQL endpoint is not public.");
      const ssl = {
        rejectUnauthorized: true,
        ...(family ? {} : { servername: endpoint.host }),
        checkServerIdentity: (_hostname, certificate) =>
          checkServerIdentity(endpoint.host, certificate),
      } satisfies Exclude<ClientConfig["ssl"], boolean | undefined>;
      return {
        host: address,
        port: endpoint.port,
        database: endpoint.database,
        ssl,
      } satisfies Required<
        Pick<ClientConfig, "host" | "port" | "database" | "ssl">
      >;
    }, 5000)
  );
}
