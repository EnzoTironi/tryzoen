import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  available: vi.fn<typeof import("expo-sharing").isAvailableAsync>(),
  share: vi.fn<typeof import("expo-sharing").shareAsync>(),
  download: vi.fn<typeof import("expo-file-system").File.downloadFileAsync>(),
  create: vi.fn<() => void>(),
  remove: vi.fn<() => void>(),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "synthetic-download" }));
vi.mock("../src/environment", () => ({ apiOrigin: "https://example.test" }));
vi.mock("../src/auth", () => ({
  accountHeaders: () => ({ Cookie: "synthetic-session" }),
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: native.available,
  shareAsync: native.share,
}));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache/" },
  Directory: class {
    create = native.create;
    delete = native.remove;
  },
  File: class {
    static downloadFileAsync = native.download;
    uri = "cache/synthetic-download/zoen-conversation.jsonl";
  },
}));
import { File } from "expo-file-system";
import { exportConversation } from "../src/files/conversation.native";

beforeEach(() => {
  vi.clearAllMocks();
  native.available.mockResolvedValue(true);
  native.download.mockResolvedValue(new File("synthetic"));
  native.share.mockResolvedValue(undefined);
});

it("downloads with the current account credentials, shares the file and removes it afterward", async () => {
  await exportConversation("synthetic/session");
  expect(native.download).toHaveBeenCalledWith(
    "https://example.test/api/conversations/synthetic%2Fsession/archive",
    expect.any(File),
    { headers: { Cookie: "synthetic-session" } }
  );
  expect(native.share).toHaveBeenCalledWith(
    "cache/synthetic-download/zoen-conversation.jsonl",
    expect.objectContaining({ mimeType: "application/x-ndjson" })
  );
  expect(native.remove).toHaveBeenCalledOnce();
});

it("never shares a failed or partial download and cleans its temporary directory", async () => {
  native.download.mockRejectedValue(
    new Error("Connection closed during export")
  );
  await expect(exportConversation("synthetic-session")).rejects.toThrow(
    "Couldn’t export"
  );
  expect(native.share).not.toHaveBeenCalled();
  expect(native.remove).toHaveBeenCalledOnce();
});

it("does not download private content when native sharing is unavailable", async () => {
  native.available.mockResolvedValue(false);
  await expect(exportConversation("synthetic-session")).rejects.toThrow(
    "not available"
  );
  expect(native.create).not.toHaveBeenCalled();
  expect(native.download).not.toHaveBeenCalled();
});
