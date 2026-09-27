import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  available: vi.fn<typeof import("expo-sharing").isAvailableAsync>(),
  share: vi.fn<typeof import("expo-sharing").shareAsync>(),
  createDirectory: vi.fn<() => void>(),
  deleteDirectory: vi.fn<() => void>(),
  createFile: vi.fn<() => void>(),
  write: vi.fn<(text: string) => void>(),
  filenames: [] as string[],
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "isolated-export" }));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: native.available,
  shareAsync: native.share,
}));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache/" },
  Directory: class {
    create = native.createDirectory;
    delete = native.deleteDirectory;
  },
  File: class {
    uri = "cache/isolated-export/file.md";
    constructor(_directory: unknown, filename: string) {
      native.filenames.push(filename);
    }
    create = native.createFile;
    write = native.write;
  },
}));
import { shareMarkdown } from "../src/editor/export";

beforeEach(() => {
  vi.clearAllMocks();
  native.filenames.length = 0;
  native.available.mockResolvedValue(true);
  native.share.mockResolvedValue(undefined);
});

it("exports the exact Markdown and cleans the private temporary file after sharing", async () => {
  const text = "---\nname: reading\n---\n# Read\n\n**One book**";
  await shareMarkdown(text, "../SOUL.md");
  expect(native.filenames).toEqual(["..-SOUL.md"]);
  expect(native.write).toHaveBeenCalledWith(text);
  expect(native.share).toHaveBeenCalledWith(
    "cache/isolated-export/file.md",
    expect.objectContaining({ mimeType: "text/markdown" })
  );
  expect(native.deleteDirectory).toHaveBeenCalledOnce();
});

it("removes the temporary export even when the operating system fails", async () => {
  native.share.mockRejectedValue(new Error("Sharing failed"));
  await expect(shareMarkdown("private notes")).rejects.toThrow(
    "Sharing failed"
  );
  expect(native.deleteDirectory).toHaveBeenCalledOnce();
});

it("does not create private files when sharing is unavailable", async () => {
  native.available.mockResolvedValue(false);
  await expect(shareMarkdown("private notes")).rejects.toThrow("not available");
  expect(native.createDirectory).not.toHaveBeenCalled();
  expect(native.write).not.toHaveBeenCalled();
});
