import { ZodError } from "zod";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import type { PeerCertificate } from "node:tls";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolvePostgresEndpoint } from "./endpoint";
import {
  operationDeadline,
  operationSignal,
  withDeadline,
  withSignal,
  withTimeout,
  TimeoutError,
} from "../../operations/async";

const dns = vi.hoisted(() => ({
  lookup:
    vi.fn<
      (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>
    >(),
}));
vi.mock("node:dns/promises", () => dns);

const endpoint = {
  host: "warehouse.example.com",
  port: 5432,
  database: "studio",
  tls: "verify-full",
};
const signal = new AbortController().signal;
const addresses = [
  { address: "93.184.216.34", family: 4 },
  { address: "2001:4860:4860::8888", family: 6 },
] satisfies [LookupAddress, LookupAddress];

// Only Node's hostname/IP SAN checker sees this synthetic metadata. It is not
// a real certificate and makes no claim about a TLS chain or live handshake.
const certificate = (subjectaltname: string): PeerCertificate => ({
  ca: false,
  raw: Buffer.alloc(0),
  subject: { CN: "synthetic.invalid" },
  issuer: { CN: "Synthetic only" },
  valid_from: "Jan 1 00:00:00 2026 GMT",
  valid_to: "Jan 1 00:00:00 2027 GMT",
  serialNumber: "00",
  fingerprint: "",
  fingerprint256: "",
  fingerprint512: "",
  subjectaltname,
});

beforeEach(() => {
  dns.lookup.mockReset().mockResolvedValue(addresses);
});
afterEach(() => {
  vi.useRealTimers();
});

test("resolves all DNS answers once and pins the first public IP with the original TLS identity", async () => {
  const resolved = await resolvePostgresEndpoint(endpoint, signal);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledWith(endpoint.host, {
    all: true,
    order: "verbatim",
  });
  expect(Object.keys(resolved).toSorted()).toEqual([
    "database",
    "host",
    "port",
    "ssl",
  ]);
  expect(resolved).toMatchObject({
    host: addresses[0].address,
    port: endpoint.port,
    database: endpoint.database,
    ssl: {
      rejectUnauthorized: true,
      servername: endpoint.host,
    },
  });
  expect(typeof resolved.ssl.checkServerIdentity).toBe("function");
  expect(Object.keys(resolved.ssl).toSorted()).toEqual([
    "checkServerIdentity",
    "rejectUnauthorized",
    "servername",
  ]);
  expect(
    resolved.ssl.checkServerIdentity(
      resolved.host,
      certificate(`DNS:${endpoint.host}`)
    )
  ).toBeUndefined();
  expect(
    resolved.ssl.checkServerIdentity(
      endpoint.host,
      certificate(`IP Address:${resolved.host}`)
    )
  ).toBeInstanceOf(Error);
  expect(
    resolved.ssl.checkServerIdentity(
      endpoint.host,
      certificate("DNS:other.example.com")
    )
  ).toBeInstanceOf(Error);
});

test("preserves the approved hostname for SNI after normalization and an IPv6 DNS answer", async () => {
  dns.lookup.mockResolvedValueOnce(addresses.toReversed());
  const resolved = await resolvePostgresEndpoint(
    { ...endpoint, host: "Warehouse.Example.COM" },
    signal
  );
  expect(resolved.host).toBe(addresses[1].address);
  expect(resolved.ssl.servername).toBe(endpoint.host);
  expect(lookup).toHaveBeenCalledTimes(1);
});

test.each(["8.8.8.8", "2001:4860:4860::8888"])(
  "public IP literal %s requires the original IP SAN without DNS or SNI",
  async (host) => {
    const resolved = await resolvePostgresEndpoint(
      { ...endpoint, host },
      signal
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(resolved.host).toBe(host);
    expect(resolved.ssl).not.toHaveProperty("servername");
    expect(resolved.ssl.rejectUnauthorized).toBe(true);
    expect(
      resolved.ssl.checkServerIdentity(
        "ignored.example.com",
        certificate(`IP Address:${host}`)
      )
    ).toBeUndefined();
    expect(
      resolved.ssl.checkServerIdentity(
        host,
        certificate(`DNS:${endpoint.host}`)
      )
    ).toBeInstanceOf(Error);
  }
);

test.each([
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "100.64.0.1",
  "168.63.129.16",
  "192.168.1.1",
  "0.0.0.0",
  "192.0.2.1",
  "198.18.0.1",
  "203.0.113.1",
  "224.0.0.1",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
  "2002:7f00:1::1",
  "not-an-ip",
])(
  "an unsafe answer %s cannot hide after a public first answer",
  async (address) => {
    dns.lookup.mockResolvedValueOnce([
      addresses[0],
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    await expect(resolvePostgresEndpoint(endpoint, signal)).rejects.toThrow(
      "not public"
    );
    expect(lookup).toHaveBeenCalledTimes(1);
  }
);

test.each(["127.0.0.1", "10.0.0.1", "::1", "::ffff:127.0.0.1"])(
  "unsafe literal %s fails without attempting DNS",
  async (host) => {
    await expect(
      resolvePostgresEndpoint({ ...endpoint, host }, signal)
    ).rejects.toThrow("not public");
    expect(lookup).not.toHaveBeenCalled();
  }
);

test("an empty answer set cannot prepare a connection", async () => {
  dns.lookup.mockResolvedValueOnce([]);
  await expect(resolvePostgresEndpoint(endpoint, signal)).rejects.toThrow(
    "not public"
  );
  expect(lookup).toHaveBeenCalledTimes(1);
});

test("DNS failure preserves the cause and does not retry resolution", async () => {
  const failure = new Error("synthetic DNS failure");
  dns.lookup.mockRejectedValueOnce(failure);
  await expect(resolvePostgresEndpoint(endpoint, signal)).rejects.toBe(failure);
  expect(lookup).toHaveBeenCalledTimes(1);
});

test.each([
  { ...endpoint, password: "synthetic-secret" },
  { ...endpoint, user: "synthetic-user" },
  { ...endpoint, connectionString: "postgres://example.com/studio" },
  { ...endpoint, ssl: { rejectUnauthorized: false } },
  { ...endpoint, tls: "require" },
  { ...endpoint, host: "/var/run/postgresql" },
  { ...endpoint, host: "warehouse.example.com,other.example.com" },
  { ...endpoint, port: 0 },
])(
  "untrusted config cannot reach DNS or override the driver contract",
  async (invalid) => {
    await expect(
      resolvePostgresEndpoint(invalid, signal)
    ).rejects.toBeInstanceOf(ZodError);
    expect(lookup).not.toHaveBeenCalled();
  }
);

test("cancellation before entry preserves its reason without DNS or timers", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const reason = new Error("synthetic user cancellation");
  controller.abort(reason);
  await expect(
    resolvePostgresEndpoint(endpoint, controller.signal)
  ).rejects.toBe(reason);
  expect(lookup).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("cancellation during DNS rejects promptly and a late answer cannot publish config", async () => {
  vi.useFakeTimers();
  const held = Promise.withResolvers<LookupAddress[]>();
  dns.lookup.mockReturnValueOnce(held.promise);
  const controller = new AbortController();
  const reason = new Error("cancel held DNS");
  const published =
    vi.fn<
      (config: Awaited<ReturnType<typeof resolvePostgresEndpoint>>) => void
    >();
  const pending = resolvePostgresEndpoint(endpoint, controller.signal).then(
    published
  );
  const outcome = pending.catch((error: unknown) => error);
  expect(lookup).toHaveBeenCalledTimes(1);
  controller.abort(reason);
  expect(await outcome).toBe(reason);
  expect(vi.getTimerCount()).toBe(0);
  held.resolve(addresses);
  await held.promise;
  await Promise.resolve();
  expect(published).not.toHaveBeenCalled();
});

test("inherited operation cancellation is observed even with an independent caller signal", async () => {
  const held = Promise.withResolvers<LookupAddress[]>();
  dns.lookup.mockReturnValueOnce(held.promise);
  const controller = new AbortController();
  const reason = new Error("parent operation cancelled");
  const pending = withSignal(controller.signal, () =>
    resolvePostgresEndpoint(endpoint, signal)
  );
  const outcome = pending.catch((error: unknown) => error);
  controller.abort(reason);
  expect(await outcome).toBe(reason);
  held.resolve(addresses);
  await held.promise;
  expect(lookup).toHaveBeenCalledTimes(1);
});

test("the five-second DNS cap clears its timer and rejects late native lookup failure safely", async () => {
  vi.useFakeTimers();
  const held = Promise.withResolvers<LookupAddress[]>();
  dns.lookup.mockReturnValueOnce(held.promise);
  const published =
    vi.fn<
      (config: Awaited<ReturnType<typeof resolvePostgresEndpoint>>) => void
    >();
  const outcome = resolvePostgresEndpoint(endpoint, signal)
    .then(published)
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await outcome).toBeInstanceOf(TimeoutError);
  expect(vi.getTimerCount()).toBe(0);
  held.reject(new Error("late synthetic DNS failure"));
  await Promise.resolve();
  await Promise.resolve();
  expect(published).not.toHaveBeenCalled();
  expect(lookup).toHaveBeenCalledTimes(1);
});

test("a shorter inherited deadline wins over the endpoint's relative cap", async () => {
  vi.useFakeTimers();
  const held = Promise.withResolvers<LookupAddress[]>();
  dns.lookup.mockReturnValueOnce(held.promise);
  const outcome = withTimeout(
    () => resolvePostgresEndpoint(endpoint, signal),
    25
  ).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(25);
  expect(await outcome).toBeInstanceOf(TimeoutError);
  expect(vi.getTimerCount()).toBe(0);
  held.resolve(addresses);
  await held.promise;
  expect(lookup).toHaveBeenCalledTimes(1);
});

test.each([0, -1])(
  "an expired absolute deadline (%sms) prevents endpoint DNS",
  async (offset) => {
    vi.useFakeTimers();
    await expect(
      withDeadline(
        () => resolvePostgresEndpoint(endpoint, signal),
        Date.now() + offset
      )
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(lookup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  }
);

test("an absolute expiry waits for started DNS and rejects its late answer without config", async () => {
  vi.useFakeTimers();
  const held = Promise.withResolvers<LookupAddress[]>();
  const entered = Promise.withResolvers<AbortSignal>();
  dns.lookup.mockImplementationOnce(() => {
    entered.resolve(operationSignal());
    return held.promise;
  });
  const published =
    vi.fn<
      (config: Awaited<ReturnType<typeof resolvePostgresEndpoint>>) => void
    >();
  const settled = vi.fn<() => void>();
  const outcome = withDeadline(
    () => resolvePostgresEndpoint(endpoint, signal),
    Date.now() + 25
  )
    .then(published)
    .catch((error: unknown) => error)
    .finally(settled);
  const effectiveSignal = await entered.promise;
  try {
    await vi.advanceTimersByTimeAsync(25);
    expect(effectiveSignal.aborted).toBe(true);
    expect(effectiveSignal.reason).toBeInstanceOf(TimeoutError);
    expect(settled).not.toHaveBeenCalled();
    expect(published).not.toHaveBeenCalled();
  } finally {
    held.resolve(addresses);
  }
  expect(await outcome).toBe(effectiveSignal.reason);
  expect(published).not.toHaveBeenCalled();
  expect(settled).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("strict cancellation drains DNS and retains its reason when the absolute deadline expires later", async () => {
  vi.useFakeTimers();
  const held = Promise.withResolvers<LookupAddress[]>();
  const entered = Promise.withResolvers<AbortSignal>();
  dns.lookup.mockImplementationOnce(() => {
    entered.resolve(operationSignal());
    return held.promise;
  });
  const controller = new AbortController();
  const reason = new Error("cancel strict endpoint lookup");
  const published =
    vi.fn<
      (config: Awaited<ReturnType<typeof resolvePostgresEndpoint>>) => void
    >();
  const settled = vi.fn<() => void>();
  const outcome = withDeadline(
    () => resolvePostgresEndpoint(endpoint, controller.signal),
    Date.now() + 25
  )
    .then(published)
    .catch((error: unknown) => error)
    .finally(settled);
  const effectiveSignal = await entered.promise;
  try {
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(25);
    expect(effectiveSignal.aborted).toBe(true);
    expect(effectiveSignal.reason).toBe(reason);
    expect(settled).not.toHaveBeenCalled();
    expect(published).not.toHaveBeenCalled();
  } finally {
    held.resolve(addresses);
  }
  expect(await outcome).toBe(reason);
  expect(published).not.toHaveBeenCalled();
  expect(settled).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("strict lookup preserves its original rejection after an absolute timeout", async () => {
  vi.useFakeTimers();
  const held = Promise.withResolvers<LookupAddress[]>();
  const entered = Promise.withResolvers<AbortSignal>();
  dns.lookup.mockImplementationOnce(() => {
    entered.resolve(operationSignal());
    return held.promise;
  });
  const original = new Error("original synthetic lookup rejection");
  const published =
    vi.fn<
      (config: Awaited<ReturnType<typeof resolvePostgresEndpoint>>) => void
    >();
  const settled = vi.fn<() => void>();
  const outcome = withDeadline(
    () => resolvePostgresEndpoint(endpoint, signal),
    Date.now() + 25
  )
    .then(published)
    .catch((error: unknown) => error)
    .finally(settled);
  const effectiveSignal = await entered.promise;
  try {
    await vi.advanceTimersByTimeAsync(25);
    expect(effectiveSignal.reason).toBeInstanceOf(TimeoutError);
    expect(settled).not.toHaveBeenCalled();
  } finally {
    held.reject(original);
  }
  expect(await outcome).toBe(original);
  expect(published).not.toHaveBeenCalled();
  expect(settled).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("time spent before DNS consumes the inherited deadline rather than a new endpoint budget", async () => {
  vi.useFakeTimers();
  const initial = Date.now();
  const deadline = initial + 25;
  const held = Promise.withResolvers<LookupAddress[]>();
  const entered = Promise.withResolvers<AbortSignal>();
  let lookupDeadline: ReturnType<typeof operationDeadline>;
  dns.lookup.mockImplementationOnce(() => {
    lookupDeadline = operationDeadline();
    entered.resolve(operationSignal());
    return held.promise;
  });
  const settled = vi.fn<() => void>();
  const outcome = withDeadline(async () => {
    vi.setSystemTime(initial + 20);
    return resolvePostgresEndpoint(endpoint, signal);
  }, deadline)
    .catch((error: unknown) => error)
    .finally(settled);
  const effectiveSignal = await entered.promise;
  try {
    expect(lookupDeadline).toBe(deadline);
    await vi.advanceTimersByTimeAsync(5);
    expect(effectiveSignal.aborted).toBe(true);
    expect(effectiveSignal.reason).toBeInstanceOf(TimeoutError);
    expect(settled).not.toHaveBeenCalled();
  } finally {
    held.resolve(addresses);
  }
  expect(await outcome).toBe(effectiveSignal.reason);
  expect(settled).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("the endpoint's shorter relative cap is an inherited strict deadline and drains lookup", async () => {
  vi.useFakeTimers();
  const initial = Date.now();
  const held = Promise.withResolvers<LookupAddress[]>();
  const entered = Promise.withResolvers<AbortSignal>();
  let lookupDeadline: ReturnType<typeof operationDeadline>;
  dns.lookup.mockImplementationOnce(() => {
    lookupDeadline = operationDeadline();
    entered.resolve(operationSignal());
    return held.promise;
  });
  const settled = vi.fn<() => void>();
  const outcome = withDeadline(
    () => resolvePostgresEndpoint(endpoint, signal),
    initial + 10_000
  )
    .catch((error: unknown) => error)
    .finally(settled);
  const effectiveSignal = await entered.promise;
  try {
    expect(lookupDeadline).toBe(initial + 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(effectiveSignal.aborted).toBe(true);
    expect(effectiveSignal.reason).toBeInstanceOf(TimeoutError);
    expect(settled).not.toHaveBeenCalled();
  } finally {
    held.resolve(addresses);
  }
  expect(await outcome).toBe(effectiveSignal.reason);
  expect(settled).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
