import { beforeEach, expect, it, vi } from "vitest";
import { pickAttachments, saveAttachment } from "./attachments.native";
import type { DocumentPickerResult } from "expo-document-picker";

const mocks = vi.hoisted(() => ({
  pick: vi.fn<() => Promise<DocumentPickerResult>>(),
  read: vi.fn<() => Promise<string>>(),
  remove: vi.fn<(uri: string) => void>(),
  share: vi.fn<() => Promise<void>>(),
  size: 1,
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: mocks.pick }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    uri: string;
    exists = true;
    constructor(uri: string) {
      this.uri = uri;
    }
    get size() {
      return mocks.size;
    }
    base64() {
      return mocks.read();
    }
    delete() {
      mocks.remove(this.uri);
    }
  },
}));
vi.mock("./files/share", () => ({ shareFile: mocks.share }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.size = 1;
  mocks.read.mockResolvedValue("YQ==");
  mocks.share.mockResolvedValue(undefined);
  mocks.pick.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: "file:///cache/picked-file",
        name: "note.txt",
        lastModified: 0,
        mimeType: "text/plain",
      },
    ],
  });
});
it("reads a cached document and removes only its temporary copy", async () => {
  expect(await pickAttachments()).toEqual([
    {
      type: "file",
      filename: "note.txt",
      mediaType: "text/plain",
      url: "data:text/plain;base64,YQ==",
    },
  ]);
  expect(mocks.pick).toHaveBeenCalledWith({
    multiple: true,
    copyToCacheDirectory: true,
  });
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(
    "file:///cache/picked-file"
  );
});
it("treats dismissal as no files", async () => {
  mocks.pick.mockResolvedValue({ canceled: true, assets: null });
  expect(await pickAttachments()).toEqual([]);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("rejects oversized files before reading and still removes the cached copy", async () => {
  mocks.size = 3 * 1024 * 1024 + 1;
  await expect(pickAttachments()).rejects.toThrow("3 MiB");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledOnce();
});
it("cleans up a failed read without deleting files outside the cache", async () => {
  mocks.pick.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: "file:///documents/original.txt",
        name: "original.txt",
        lastModified: 0,
        mimeType: "text/plain",
      },
    ],
  });
  mocks.read.mockRejectedValueOnce(new Error("Read failed"));
  await expect(pickAttachments()).rejects.toThrow("Read failed");
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("passes validated inline bytes to the platform share sheet", async () => {
  await saveAttachment({
    type: "file",
    filename: "note.txt",
    mediaType: "text/plain",
    url: "data:text/plain;base64,YQ==",
  });
  expect(mocks.share).toHaveBeenCalledExactlyOnceWith("YQ==", {
    filename: "note.txt",
    mediaType: "text/plain",
    encoding: "base64",
  });
  await expect(
    saveAttachment({
      type: "file",
      mediaType: "text/html",
      url: "javascript:alert(1)",
    })
  ).rejects.toThrow(/Invalid/u);
  expect(mocks.share).toHaveBeenCalledOnce();
});
