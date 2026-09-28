import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  pickBrowserAttachments,
  readFileDataUrl,
  saveBrowserAttachment,
} from "./attachments";

class MockInput extends EventTarget {
  type = "";
  multiple = false;
  hidden = false;
  files: File[] = [];
  remove = vi.fn<() => void>();
  click = vi.fn<() => void>();
}
let input = new MockInput();
const link = { href: "", download: "", click: vi.fn<() => void>() };
const readers: MockFileReader[] = [];
const read = vi.fn<(blob: Blob) => void>();
class MockFileReader extends EventTarget {
  result: string | null = null;
  constructor() {
    super();
    readers.push(this);
  }
  readAsDataURL(blob: Blob) {
    read(blob);
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  input = new MockInput();
  readers.length = 0;
  vi.stubGlobal("document", {
    createElement: (tag: string) => (tag === "a" ? link : input),
    body: { append: vi.fn<() => void>() },
  });
  vi.stubGlobal("FileReader", MockFileReader);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("resolves cancellation and removes the hidden chooser", async () => {
  const pending = pickBrowserAttachments();
  expect(input.multiple).toBe(true);
  expect(input.click).toHaveBeenCalledOnce();
  input.dispatchEvent(new Event("cancel"));
  expect(await pending).toEqual([]);
  expect(input.remove).toHaveBeenCalledOnce();
});
it("converts selected bytes using the detected MIME type", async () => {
  const pending = pickBrowserAttachments();
  input.files = [new File(["a"], "note.txt", { type: "text/plain" })];
  input.dispatchEvent(new Event("change"));
  expect(read.mock.calls[0]?.[0].type).toBe("text/plain");
  readerAt(0).result = "data:text/plain;base64,YQ==";
  readerAt(0).dispatchEvent(new Event("load"));
  expect(await pending).toEqual([
    {
      type: "file",
      filename: "note.txt",
      mediaType: "text/plain",
      url: readerAt(0).result,
    },
  ]);
  expect(input.remove).toHaveBeenCalledOnce();
});
it("uses a binary MIME type for files without a detected type", async () => {
  const pending = pickBrowserAttachments();
  input.files = [new File(["a"], "unknown")];
  input.dispatchEvent(new Event("change"));
  expect(read.mock.calls[0]?.[0].type).toBe("application/octet-stream");
  readerAt(0).result = "data:application/octet-stream;base64,YQ==";
  readerAt(0).dispatchEvent(new Event("load"));
  expect((await pending)[0]?.mediaType).toBe("application/octet-stream");
});
it("refuses oversized selections before allocating their encoded bytes", async () => {
  const pending = pickBrowserAttachments();
  input.files = [new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.bin")];
  input.dispatchEvent(new Event("change"));
  await expect(pending).rejects.toThrow("3 MiB");
  expect(read).not.toHaveBeenCalled();
});
it("reports reader failure and cancellation", async () => {
  const failed = readFileDataUrl(new Blob(["a"]));
  readerAt(0).dispatchEvent(new Event("error"));
  await expect(failed).rejects.toThrow("could not be read");
  const cancelled = readFileDataUrl(new Blob(["a"]));
  readerAt(1).dispatchEvent(new Event("abort"));
  await expect(cancelled).rejects.toThrow("cancelled");
});
it("downloads inline files without navigating to executable data URLs and releases the object URL", async () => {
  vi.useFakeTimers();
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:test-file");
  const revoke = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => undefined);
  await saveBrowserAttachment({
    type: "file",
    filename: "../page.html",
    mediaType: "text/html",
    url: "data:text/html;base64,YQ==",
  });
  expect(link.href).toBe("blob:test-file");
  expect(link.download).toBe("..-page.html");
  expect(link.click).toHaveBeenCalledOnce();
  const downloaded = create.mock.calls[0]?.[0];
  if (!(downloaded instanceof Blob))
    throw new Error("Expected a file download");
  expect(await downloaded.text()).toBe("a");
  expect(revoke).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(revoke).toHaveBeenCalledWith("blob:test-file");
});

function readerAt(index: number) {
  const reader = readers[index];
  if (!reader) throw new Error("Expected a file reader");
  return reader;
}
