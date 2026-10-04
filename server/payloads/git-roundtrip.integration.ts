import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, request, type ClientRequest } from "node:http";
import { dirname, join } from "node:path";
import type { Socket } from "node:net";
import { S3Client } from "@aws-sdk/client-s3";
import { expect, it } from "vitest";
import { z } from "zod";
import { publishWorkspaceGit, readWorkspaceGit } from "../workspaces/git";
import {
  operationDeadline,
  TimeoutError,
  withDeadline,
} from "../operations/async";
import { S3PrivatePayloads } from "./s3";
import type { PayloadReference } from "./contract";
import { fixtureEnvironment } from "../../scripts/verification/env";

const fixturePath = fixtureEnvironment.ZOEN_STORAGE_FIXTURE;
const fixtureSchema = z.object({
  endpoint: z.literal("http://127.0.0.1:19480"),
  bucket: z.literal("synthetic-storage-2a69cdcd"),
  fixtureId: z.uuid(),
});
const credentialsSchema = z.object({
  accessKeyId: z.string().startsWith("synthetic-"),
  secretAccessKey: z.string().min(1),
});
type Fault =
  | "none"
  | "hash"
  | "short"
  | "long"
  | "header"
  | "metadata-id"
  | "metadata-sha"
  | "pre-header"
  | "stall"
  | "disconnect"
  | "lost-ack"
  | "409"
  | "429";
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// This suite needs the explicitly provisioned, owned RustFS fixture. The proxy
// forwards real signed HTTP requests and injects transport faults only. It never
// supplies a storage implementation, permission decision or publication receipt.
it.skipIf(!fixturePath)(
  "qualifies actual Git, SDK and RustFS with physical transport faults",
  async () => {
    if (!fixturePath)
      throw new Error("Set ZOEN_STORAGE_FIXTURE to the owned receipt");
    const fixture = fixtureSchema.parse(
      JSON.parse(await readFile(fixturePath, "utf8"))
    );
    const credentials = credentialsSchema.parse(
      JSON.parse(
        await readFile(join(dirname(fixturePath), "credentials.json"), "utf8")
      )
    );
    let fault: Fault = "none";
    const sockets = new Set<Socket>();
    const upstreams = new Set<ClientRequest>();
    const wire: {
      method: string;
      path: string;
      fault: Fault;
      status?: number;
      conditional?: string;
      checksum?: string;
      payloadId?: string;
      sha256?: string;
      contentLength?: string;
    }[] = [];
    let closed = Promise.withResolvers<void>();
    let phase = Promise.withResolvers<void>();
    const proxy = createServer((incoming, outgoing) => {
      const selected = fault;
      const observation: (typeof wire)[number] = {
        method: incoming.method ?? "",
        path: incoming.url ?? "",
        fault: selected,
        conditional: incoming.headers["if-none-match"]?.toString(),
        checksum: incoming.headers["x-amz-checksum-sha256"]?.toString(),
        payloadId: incoming.headers["x-amz-meta-payload-id"]?.toString(),
        sha256: incoming.headers["x-amz-meta-sha256"]?.toString(),
        contentLength: incoming.headers["content-length"],
      };
      wire.push(observation);
      const upstream = request(
        new URL(incoming.url ?? "/", fixture.endpoint),
        { method: incoming.method, headers: incoming.headers },
        (response) => {
          observation.status = response.statusCode;
          if (
            selected === "lost-ack" &&
            (incoming.method === "PUT" || incoming.method === "DELETE")
          ) {
            response.resume();
            response.on("end", () => outgoing.destroy());
            return;
          }
          if (
            incoming.method === "PUT" &&
            (selected === "409" || selected === "429")
          ) {
            response.resume();
            outgoing.writeHead(Number(selected), {
              "content-type": "application/xml",
            });
            outgoing.end(
              `<Error><Code>${selected === "429" ? "SlowDown" : "ConditionalRequestConflict"}</Code></Error>`
            );
            return;
          }
          if (incoming.method !== "GET" || selected === "none") {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
            return;
          }
          const headers = Object.fromEntries(
            Object.entries(response.headers).filter(
              ([name]) => !name.startsWith("x-amz-checksum-")
            )
          );
          if (selected === "metadata-id")
            headers["x-amz-meta-payload-id"] = randomUUID();
          if (selected === "metadata-sha")
            headers["x-amz-meta-sha256"] = "0".repeat(64);
          // Deliberately remove provider checksums so the application must detect the
          // fault itself. This is a recorded wire fault, not an R2/RustFS behavior claim.
          if (selected === "409" || selected === "429") {
            response.resume();
            delete headers["content-length"];
            outgoing.writeHead(Number(selected), headers);
            outgoing.end(
              `<Error><Code>${selected === "429" ? "SlowDown" : "ConditionalRequestConflict"}</Code></Error>`
            );
            return;
          }
          if (selected === "stall" || selected === "pre-header") {
            response.destroy();
            outgoing.on("close", () => {
              closed.resolve();
            });
            if (selected === "pre-header") {
              phase.resolve();
              return;
            }
            outgoing.writeHead(200, headers);
            outgoing.flushHeaders();
            return;
          }
          if (selected === "disconnect") {
            response.destroy();
            outgoing.writeHead(200, headers);
            outgoing.flushHeaders();
            outgoing.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const bytes = Buffer.concat(chunks);
            delete headers["content-length"];
            outgoing.writeHead(
              200,
              selected === "header"
                ? { ...headers, "content-length": bytes.length + 1 }
                : headers
            );
            outgoing.end(
              selected === "hash"
                ? Buffer.alloc(bytes.length)
                : selected === "short"
                  ? bytes.subarray(1)
                  : selected === "long"
                    ? Buffer.concat([bytes, Buffer.from([1])])
                    : bytes
            );
          });
        }
      );
      upstreams.add(upstream);
      upstream.on("close", () => upstreams.delete(upstream));
      upstream.on("error", () => outgoing.destroy());
      outgoing.on("close", () => upstream.destroy());
      incoming.pipe(upstream);
    });
    proxy.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === "string")
      throw new Error("No loopback proxy address");
    const client = new S3Client({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: "us-east-1",
      forcePathStyle: true,
      credentials,
      maxAttempts: 1,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    // Observe completion of real SDK deserialization, without replacing the
    // handler or body. The next event-loop turn lets the adapter enter its read.
    client.middlewareStack.add(
      (next) => async (args) => {
        const result = await next(args);
        if (fault === "stall")
          setImmediate(() => {
            phase.resolve();
          });
        return result;
      },
      { step: "initialize", name: "observeActualHeaders" }
    );
    const adapter = new S3PrivatePayloads(client, {
      bucket: fixture.bucket,
      prefix: "no-mock/v1",
    });
    const deadlineMs = Date.now() + 20_000;
    const signal = new AbortController().signal;
    const reference = (bytes: Uint8Array) => ({
      workspaceId: "synthetic-real",
      ownerGeneration: fixture.fixtureId,
      candidateId: randomUUID(),
      kind: "workspace-source" as const,
      ownerUserId: null,
      sha256: sha256(bytes),
      byteLength: bytes.length,
    });
    const bytes = Buffer.from("real transport evidence");
    const candidate = reference(bytes);
    const retained: PayloadReference[] = [];
    const checked: string[] = [];
    try {
      const count = wire.length;
      await expect(
        adapter.putVerified({
          candidate: { ...candidate, sha256: "0".repeat(64) },
          bytes,
          signal,
          deadlineMs,
        })
      ).rejects.toMatchObject({ reason: "invalid" });
      await expect(
        adapter.putVerified({
          candidate: { ...candidate, byteLength: 1 },
          bytes,
          signal,
          deadlineMs,
        })
      ).rejects.toMatchObject({ reason: "invalid" });
      expect(wire).toHaveLength(count);
      checked.push("invalid input before transport");
      const aborted = AbortSignal.abort(new Error("already cancelled"));
      await expect(
        adapter.putVerified({ candidate, bytes, signal: aborted, deadlineMs })
      ).rejects.toThrow("already cancelled");
      await expect(
        adapter.readVerified({
          reference: candidate,
          signal: aborted,
          deadlineMs,
        })
      ).rejects.toThrow("already cancelled");
      expect(wire).toHaveLength(count);
      checked.push("pre-aborted read and write perform no I/O");
      expect(
        await adapter.putVerified({ candidate, bytes, signal, deadlineMs })
      ).toStrictEqual(candidate);
      retained.push(candidate);
      expect(
        await adapter.putVerified({ candidate, bytes, signal, deadlineMs })
      ).toStrictEqual(candidate);
      checked.push("created and duplicate returned references");
      const expectedPath = `/${fixture.bucket}/no-mock/v1/workspace/${sha256(Buffer.from(candidate.workspaceId))}/${candidate.ownerGeneration}/${candidate.kind}/${candidate.candidateId}`;
      expect(wire).toHaveLength(count + 4);
      for (const entry of wire.slice(count)) {
        expect(new URL(entry.path, fixture.endpoint).pathname).toBe(
          expectedPath
        );
      }
      for (const entry of wire
        .slice(count)
        .filter((item) => item.method === "PUT")) {
        expect(entry.checksum).toBeUndefined();
        expect(entry.payloadId).toBe(candidate.candidateId);
        expect(entry.sha256).toBe(candidate.sha256);
        expect(entry.contentLength).toBe(String(bytes.length));
        expect(entry.conditional).toBe("*");
      }
      checked.push(
        "exact private key, integrity metadata, length and conditional wire headers"
      );
      const binary = Buffer.from([0, 255, 128, 195, 40, 0, 13, 10, 254]);
      const binaryRef = reference(binary);
      expect(
        await adapter.putVerified({
          candidate: binaryRef,
          bytes: binary,
          signal,
          deadlineMs,
        })
      ).toStrictEqual(binaryRef);
      retained.push(binaryRef);
      const binaryExport = await adapter.readVerified({
        reference: binaryRef,
        signal,
        deadlineMs,
      });
      expect(Buffer.from(binaryExport)).toEqual(binary);
      expect(sha256(binaryExport)).toBe(binaryRef.sha256);
      checked.push("binary source exact byte and hash export parity");
      expect(
        wire
          .filter((x) => x.method === "PUT")
          .every((x) => x.conditional === "*")
      ).toBe(true);
      expect(wire.some((x) => x.status === 412)).toBe(true);
      checked.push("conditional create and exact duplicate");
      const wrong = Buffer.alloc(bytes.length);
      await expect(
        adapter.putVerified({
          candidate: { ...candidate, sha256: sha256(wrong) },
          bytes: wrong,
          signal,
          deadlineMs,
        })
      ).rejects.toMatchObject({ reason: "corrupt" });
      checked.push("mismatched candidate rejected after 412 readback");
      await expect(
        adapter.readVerified({
          reference: reference(bytes),
          signal,
          deadlineMs,
        })
      ).rejects.toMatchObject({ reason: "missing" });
      checked.push("real missing object");
      for (const mode of [
        "hash",
        "short",
        "long",
        "header",
        "metadata-id",
        "metadata-sha",
      ] as const) {
        fault = mode;
        await expect(
          adapter.readVerified({ reference: candidate, signal, deadlineMs })
        ).rejects.toMatchObject({ reason: "corrupt" });
        checked.push(`response ${mode}`);
      }
      for (const mode of ["disconnect", "409", "429"] as const) {
        fault = mode;
        await expect(
          adapter.readVerified({ reference: candidate, signal, deadlineMs })
        ).rejects.toBeInstanceOf(Error);
        checked.push(`transport ${mode}`);
      }
      fault = "pre-header";
      phase = Promise.withResolvers<void>();
      closed = Promise.withResolvers<void>();
      const beforeHeaders = new AbortController();
      await Promise.all([
        expect(
          adapter.readVerified({
            reference: candidate,
            signal: beforeHeaders.signal,
            deadlineMs,
          })
        ).rejects.toMatchObject({ name: "AbortError" }),
        (async () => {
          await phase.promise;
          beforeHeaders.abort(new Error("cancel before headers"));
        })(),
      ]);
      await closed.promise;
      checked.push("pre-header SDK abort physically closes socket");
      fault = "stall";
      phase = Promise.withResolvers<void>();
      closed = Promise.withResolvers<void>();
      const bodyDeadline = Math.min(deadlineMs, Date.now() + 1000);
      await Promise.all([
        expect(
          adapter.readVerified({
            reference: candidate,
            signal,
            deadlineMs: bodyDeadline,
          })
        ).rejects.toBeInstanceOf(TimeoutError),
        (async () => {
          await phase.promise;
          expect(Date.now()).toBeLessThan(bodyDeadline);
        })(),
      ]);
      await closed.promise;
      checked.push(
        "body deadline physically closes socket after observed SDK headers"
      );
      phase = Promise.withResolvers<void>();
      closed = Promise.withResolvers<void>();
      const controller = new AbortController();
      await Promise.all([
        expect(
          adapter.readVerified({
            reference: candidate,
            signal: controller.signal,
            deadlineMs,
          })
        ).rejects.toThrow("owned cancellation"),
        (async () => {
          await phase.promise;
          controller.abort(new Error("owned cancellation"));
        })(),
      ]);
      await closed.promise;
      checked.push(
        "caller cancellation physically closes socket after observed SDK headers"
      );
      phase = Promise.withResolvers<void>();
      closed = Promise.withResolvers<void>();
      const earlier = Math.min(deadlineMs, Date.now() + 1000);
      await Promise.all([
        expect(
          withDeadline(
            () =>
              adapter.readVerified({
                reference: candidate,
                signal,
                deadlineMs,
              }),
            earlier
          )
        ).rejects.toBeInstanceOf(TimeoutError),
        (async () => {
          await phase.promise;
          expect(Date.now()).toBeLessThan(earlier);
        })(),
      ]);
      await closed.promise;
      const beforeRetry = wire.length;
      await expect(
        adapter.putVerified({ candidate, bytes, signal, deadlineMs: earlier })
      ).rejects.toBeInstanceOf(TimeoutError);
      expect(wire).toHaveLength(beforeRetry);
      checked.push("inherited earlier deadline and expired retry");
      for (const status of ["409", "429"] as const) {
        fault = status;
        const interrupted = reference(bytes);
        await expect(
          adapter.putVerified({
            candidate: interrupted,
            bytes,
            signal,
            deadlineMs,
          })
        ).rejects.toMatchObject({
          $metadata: { httpStatusCode: Number(status) },
        });
        fault = "none";
        await adapter.putVerified({
          candidate: interrupted,
          bytes,
          signal,
          deadlineMs,
        });
        retained.push(interrupted);
        checked.push(`PUT ${status} exact-candidate recovery`);
      }
      fault = "lost-ack";
      const unknown = reference(bytes);
      await expect(
        adapter.putVerified({ candidate: unknown, bytes, signal, deadlineMs })
      ).rejects.toBeInstanceOf(Error);
      fault = "none";
      await adapter.putVerified({
        candidate: unknown,
        bytes,
        signal,
        deadlineMs,
      });
      retained.push(unknown);
      checked.push(
        "real committed PUT lost acknowledgement exact identity recovery"
      );
      const mutable = Uint8Array.from(bytes);
      const copy = reference(bytes);
      const upload = adapter.putVerified({
        candidate: copy,
        bytes: mutable,
        signal,
        deadlineMs,
      });
      mutable.fill(0);
      await upload;
      retained.push(copy);
      expect(
        Buffer.from(
          await adapter.readVerified({ reference: copy, signal, deadlineMs })
        )
      ).toEqual(bytes);
      checked.push("caller byte mutation isolation");
      for (const coordinate of [
        { workspaceId: "synthetic-company" },
        { ownerGeneration: randomUUID() },
        { kind: "workspace-bundle" as const },
        {
          kind: "private-memory-bundle" as const,
          ownerUserId: "better-auth:synthetic-owner",
        },
        {
          kind: "private-artifact" as const,
          ownerUserId: "better-auth:synthetic-owner",
        },
        {
          kind: "private-artifact" as const,
          ownerUserId: "better-auth:synthetic-neighbor",
        },
      ]) {
        const scoped = { ...candidate, ...coordinate };
        await adapter.putVerified({
          candidate: scoped,
          bytes,
          signal,
          deadlineMs,
        });
        retained.push(scoped);
      }
      expect(
        new Set(
          wire
            .filter((x) => x.method === "PUT" && x.status === 200)
            .map((x) => x.path)
        ).size
      ).toBe(retained.length);
      checked.push(
        "distinct workspace, owner generation and all four payload kind keys"
      );
      const first = await publishWorkspaceGit({
        bundle: null,
        parent: null,
        changes: [{ path: "knowledge/example.md", content: "first" }],
        message: "Real first",
      });
      const firstRef = {
        ...reference(first.bundle),
        kind: "workspace-bundle" as const,
      };
      await adapter.putVerified({
        candidate: firstRef,
        bytes: first.bundle,
        signal,
        deadlineMs,
      });
      retained.push(firstRef);
      const recovered = await adapter.readVerified({
        reference: firstRef,
        signal,
        deadlineMs,
      });
      expect(Buffer.from(recovered)).toEqual(first.bundle);
      const second = await publishWorkspaceGit({
        bundle: recovered,
        parent: first.revision,
        changes: [{ path: "knowledge/example.md", content: "second" }],
        message: "Real second",
      });
      const secondRef = {
        ...reference(second.bundle),
        kind: "workspace-bundle" as const,
      };
      await adapter.putVerified({
        candidate: secondRef,
        bytes: second.bundle,
        signal,
        deadlineMs,
      });
      retained.push(secondRef);
      const exported = await adapter.readVerified({
        reference: secondRef,
        signal,
        deadlineMs,
      });
      expect(Buffer.from(exported)).toEqual(second.bundle);
      expect(
        (
          await readWorkspaceGit(
            exported,
            first.revision,
            "knowledge/example.md"
          )
        ).content
      ).toBe("first");
      expect(
        (
          await readWorkspaceGit(
            exported,
            second.revision,
            "knowledge/example.md"
          )
        ).content
      ).toBe("second");
      checked.push(
        "actual environment and native Git two revisions byte parity"
      );
      const privateBundle = {
        ...secondRef,
        kind: "private-memory-bundle" as const,
        ownerUserId: "better-auth:synthetic-owner",
      };
      await adapter.putVerified({
        candidate: privateBundle,
        bytes: second.bundle,
        signal,
        deadlineMs,
      });
      retained.push(privateBundle);
      const privateExport = await adapter.readVerified({
        reference: privateBundle,
        signal,
        deadlineMs,
      });
      expect(Buffer.from(privateExport)).toEqual(second.bundle);
      expect(
        (
          await readWorkspaceGit(
            privateExport,
            first.revision,
            "knowledge/example.md"
          )
        ).content
      ).toBe("first");
      expect(
        (
          await readWorkspaceGit(
            privateExport,
            second.revision,
            "knowledge/example.md"
          )
        ).content
      ).toBe("second");
      checked.push(
        "private memory Git bundle retains both revisions and exact bytes"
      );
      const artifact = {
        ...binaryRef,
        kind: "private-artifact" as const,
        ownerUserId: "better-auth:synthetic-owner",
      };
      await adapter.putVerified({
        candidate: artifact,
        bytes: binary,
        signal,
        deadlineMs,
      });
      retained.push(artifact);
      expect(
        Buffer.from(
          await adapter.readVerified({
            reference: artifact,
            signal,
            deadlineMs,
          })
        )
      ).toEqual(binary);
      checked.push("private artifact retains opaque binary bytes");
      fault = "lost-ack";
      await expect(
        adapter.removeExact({ reference: artifact, signal, deadlineMs })
      ).rejects.toBeInstanceOf(Error);
      fault = "none";
      await expect(
        adapter.readVerified({ reference: artifact, signal, deadlineMs })
      ).rejects.toMatchObject({ reason: "missing" });
      await adapter.removeExact({ reference: artifact, signal, deadlineMs });
      await adapter.removeExact({ reference: artifact, signal, deadlineMs });
      expect(
        Buffer.from(
          await adapter.readVerified({
            reference: binaryRef,
            signal,
            deadlineMs,
          })
        )
      ).toEqual(binary);
      checked.push(
        "real committed DELETE lost acknowledgement, exact-key recovery and neighboring key preservation"
      );
      expect(operationDeadline()).toBeUndefined();
    } finally {
      fault = "none";
      client.destroy();
      for (const upstream of upstreams) upstream.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => {
          if (error) reject(error);
          else resolve();
        })
      );
      if (fixtureEnvironment.ZOEN_STORAGE_EVIDENCE)
        await writeFile(
          fixtureEnvironment.ZOEN_STORAGE_EVIDENCE,
          JSON.stringify({ checked, wire, retained }, null, 2)
        );
    }
  },
  30_000
);
