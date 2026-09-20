import { createServer } from "node:net";

/** Check before readiness probing so another process cannot impersonate our server. */
export async function requireServerPort(hostname: string, port: number) {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: hostname, port, exclusive: true }, resolve);
    });
  } catch {
    throw new Error(
      `Port ${port} on ${hostname} is unavailable. Stop its owner or choose another port.`
    );
  } finally {
    if (server.listening)
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
  }
}
