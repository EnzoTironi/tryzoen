import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";

function writeJson(outgoing: ServerResponse, status: number, body: string) {
  outgoing.writeHead(status, { "content-type": "application/json" });
  outgoing.end(body);
}

function bearer(incoming: IncomingMessage) {
  return incoming.headers.authorization ?? "";
}

function deactivationHold() {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    markEntered: entered.resolve,
    waiting: released.promise,
    release: released.resolve,
  };
}

export async function accountDeletionProvidersFixture() {
  const logouts: string[] = [];
  const vaultUsers: string[] = [];
  const deactivated: string[] = [];
  const matrixAttempts: string[] = [];
  const matrixFailures = new Set<string>();
  const nextHolds = new Map<string, ReturnType<typeof deactivationHold>>();
  const allHolds = new Set<ReturnType<typeof deactivationHold>>();

  const server = createServer((incoming, outgoing) => {
    const receive = async () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      try {
        if (path === "/alive") {
          writeJson(outgoing, 200, JSON.stringify({ ok: true }));
          return;
        }
        if (path === "/_matrix/mau/ready" || path === "/_matrix/mau/live") {
          writeJson(outgoing, 200, JSON.stringify({ ok: true }));
          return;
        }
        const vault = /^\/admin\/users\/([^/]+)$/.exec(path);
        if (vault && incoming.method === "DELETE") {
          if (
            bearer(incoming) !==
            "Bearer synthetic-deletion-vault-client-secret-32"
          ) {
            writeJson(outgoing, 401, "{}");
            return;
          }
          vaultUsers.push(decodeURIComponent(vault[1] ?? ""));
          writeJson(outgoing, 200, "{}");
          return;
        }
        if (
          path === "/_matrix/provision/v3/login/start/qr" &&
          incoming.method === "POST"
        ) {
          if (
            bearer(incoming) !==
            "Bearer synthetic-deletion-whatsapp-provision-32b"
          ) {
            writeJson(outgoing, 401, "{}");
            return;
          }
          const loginId = randomUUID();
          writeJson(
            outgoing,
            200,
            JSON.stringify({
              login_id: loginId,
              type: "display_and_wait",
              display_and_wait: { type: "qr", data: "synthetic-deletion-qr" },
            })
          );
          return;
        }
        const logout = /^\/_matrix\/provision\/v3\/logout\/([^/]+)$/.exec(path);
        if (logout && incoming.method === "POST") {
          if (
            bearer(incoming) !==
            "Bearer synthetic-deletion-whatsapp-provision-32b"
          ) {
            writeJson(outgoing, 401, "{}");
            return;
          }
          logouts.push(decodeURIComponent(logout[1] ?? "all"));
          writeJson(outgoing, 200, "{}");
          return;
        }
        const deactivate = /^\/_synapse\/admin\/v1\/deactivate\/(.+)$/.exec(
          path
        );
        if (deactivate && incoming.method === "POST") {
          if (
            bearer(incoming) !==
            "Bearer synthetic-deletion-matrix-appservice-32bx"
          ) {
            writeJson(outgoing, 401, "{}");
            return;
          }
          const matrixId = decodeURIComponent(deactivate[1] ?? "");
          matrixAttempts.push(matrixId);
          const status = matrixFailures.has(matrixId) ? 503 : 200;
          const hold = nextHolds.get(matrixId);
          if (hold) {
            nextHolds.delete(matrixId);
            hold.markEntered();
            await hold.waiting;
          }
          if (status === 200) deactivated.push(matrixId);
          writeJson(outgoing, status, "{}");
          return;
        }
        const user = /^\/_synapse\/admin\/v2\/users\/(.+)$/.exec(path);
        if (user && incoming.method === "GET") {
          if (
            bearer(incoming) !==
            "Bearer synthetic-deletion-matrix-appservice-32bx"
          ) {
            writeJson(outgoing, 401, "{}");
            return;
          }
          const matrixId = decodeURIComponent(user[1] ?? "");
          const erased = deactivated.includes(matrixId);
          writeJson(
            outgoing,
            200,
            JSON.stringify({ name: matrixId, deactivated: erased, erased })
          );
          return;
        }
        writeJson(outgoing, 404, JSON.stringify({ errcode: "M_UNRECOGNIZED" }));
      } catch {
        writeJson(outgoing, 500, "{}");
      }
    };
    void receive();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(14352, "127.0.0.1", resolve);
  });
  return {
    deactivated,
    matrixAttempts,
    setMatrixFailure(id: string, failing: boolean) {
      if (failing) matrixFailures.add(id);
      else matrixFailures.delete(id);
    },
    holdNextMatrixDeactivation(id: string) {
      if (nextHolds.has(id))
        throw new Error("A Matrix deactivation is already held.");
      const hold = deactivationHold();
      nextHolds.set(id, hold);
      allHolds.add(hold);
      return { entered: hold.entered, release: hold.release };
    },
    logouts,
    vaultUsers,
    close: () =>
      new Promise<void>((resolve) => {
        for (const hold of allHolds) hold.release();
        server.close(() => {
          resolve();
        });
      }),
  };
}
