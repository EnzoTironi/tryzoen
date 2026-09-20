import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessScope } from "@shared/identity/access-scope";
import { PersonalMemoryError } from "../personal-memory/access";
import type * as PersonalMemoryAccess from "../personal-memory/access";
const readAuthSessionMock = vi.hoisted(() =>
  vi.fn<(headers: Headers) => Promise<null>>((_headers) =>
    Promise.resolve(null)
  )
);
vi.mock("@db/services/auth/session", () => ({
  readAuthSession: (headers: Headers) => readAuthSessionMock(headers),
}));
vi.mock("../personal-memory/export", () => ({
  inspectPersonalMemory: async function (headers: Headers) {
    await readAuthSessionMock(headers);
    throw new PersonalMemoryError({
      reason: "unauthenticated",
    });
  },
}));
vi.mock("../personal-memory/access", async (importOriginal) => {
  const actual = await importOriginal<typeof PersonalMemoryAccess>();
  return {
    ...actual,
    requirePersonalMemoryWebSession: async function (
      _scope: AccessScope,
      _sessionId: string
    ) {
      throw new actual.PersonalMemoryError({
        reason: "unauthenticated",
      });
    },
  };
});
import {
  AccountPrivacyError,
  accountPrivacyErrorResponse,
  deleteAccountOnlineData,
  exportAccountPrivacy,
} from "./privacy";
const wipeMock = vi.hoisted(() =>
  vi.fn<(scope: AccessScope) => void>(() => undefined)
);
const sqlMock = vi.hoisted(() =>
  vi.fn<() => Promise<never>>(() =>
    Promise.reject(new Error("SQL must not run without auth"))
  )
);
vi.mock("@db/queries", async (original) => ({
  ...(await original<typeof import("@db/queries")>()),
  query: sqlMock,
}));
vi.mock("../personal-memory", () => ({
  PersonalMemory: {
    bind: async () => {
      throw new Error("bind must not run without auth");
    },
    inspect: async () => {
      throw new Error("inspect must not run without auth");
    },
    wipe: async (scope: AccessScope) => {
      wipeMock(scope);
      throw new Error("wipe must not run without auth");
    },
  },
}));
describe("account privacy gates", () => {
  beforeEach(() => {
    readAuthSessionMock.mockReset();
    readAuthSessionMock.mockImplementation(() => Promise.resolve(null));
    wipeMock.mockReset();
    sqlMock.mockClear();
  });
  it("export fails closed without auth and never wipes personal memory", async () => {
    await expect(exportAccountPrivacy(new Headers())).rejects.toMatchObject({
      _tag: "AccountPrivacyError",
      reason: "unauthenticated",
    });
    expect(wipeMock).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
  });
  it("delete fails closed without auth and never wipes personal memory", async () => {
    await expect(deleteAccountOnlineData(new Headers())).rejects.toMatchObject({
      _tag: "AccountPrivacyError",
      reason: "unauthenticated",
    });
    expect(wipeMock).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
  });
  it("maps unauthenticated privacy errors to HTTP 401 fail-closed responses", () => {
    const response = accountPrivacyErrorResponse(
      new AccountPrivacyError({
        reason: "unauthenticated",
      })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("maps unavailable privacy errors to HTTP 503", () => {
    const response = accountPrivacyErrorResponse(
      new AccountPrivacyError({
        reason: "unavailable",
      })
    );
    expect(response.status).toBe(503);
  });
});
