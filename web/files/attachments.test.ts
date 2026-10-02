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
  static EMPTY = 0;
  static LOADING = 1;
  static DONE = 2;
  readyState = MockFileReader.EMPTY;
  result: string | null = null;
  abort = vi.fn<() => void>(() => {
    if (this.readyState !== MockFileReader.LOADING) return;
    this.readyState = MockFileReader.DONE;
    this.result = null;
    this.dispatchEvent(new Event("abort"));
  });
  constructor() {
    super();
    readers.push(this);
  }
  readAsDataURL(blob: Blob) {
    this.readyState = MockFileReader.LOADING;
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

it("cancels sibling readers when one file fails and ignores late completions", async () => {
  const pending = pickBrowserAttachments();
  input.files = [
    new File(["a"], "one.txt", { type: "text/plain" }),
    new File(["b"], "two.txt", { type: "text/plain" }),
  ];
  input.dispatchEvent(new Event("change"));
  readerAt(0).readyState = MockFileReader.DONE;
  readerAt(0).dispatchEvent(new Event("error"));
  await expect(pending).rejects.toThrow("could not be read");
  expect(readerAt(1).abort).toHaveBeenCalledTimes(1);
  expect(readerAt(1).readyState).toBe(MockFileReader.DONE);
  readerAt(1).result = "data:text/plain;base64,Yg==";
  readerAt(1).dispatchEvent(new Event("load"));
  expect(input.remove).toHaveBeenCalledTimes(1);
});

it("rejects an already cancelled read without allocating a FileReader", async () => {
  const controller = new AbortController();
  const reason = new Error("Synthetic cancellation");
  controller.abort(reason);
  await expect(
    readFileDataUrl(new Blob(["a"]), { signal: controller.signal })
  ).rejects.toBe(reason);
  expect(readers).toEqual([]);
});

it("aborts an active read and removes signal and reader listeners", async () => {
  const controller = new AbortController();
  const reason = new Error("Synthetic cancellation");
  const progress = vi.fn<(loaded: number, total: number) => void>();
  const removeSignalListener = vi.spyOn(
    controller.signal,
    "removeEventListener"
  );
  const pending = readFileDataUrl(new Blob(["abc"]), {
    signal: controller.signal,
    onLocalReadProgress: progress,
  });
  const reader = readerAt(0);
  const removeReaderListener = vi.spyOn(reader, "removeEventListener");
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(reader.abort).toHaveBeenCalledTimes(1);
  expect(removeSignalListener.mock.calls.map(([event]) => event)).toContain(
    "abort"
  );
  expect(
    removeReaderListener.mock.calls.map(([event]) => event).toSorted()
  ).toEqual(["abort", "error", "load", "progress"]);
  reader.dispatchEvent(localProgress(2));
  reader.result = "data:text/plain;base64,YWJj";
  reader.dispatchEvent(new Event("load"));
  expect(progress).not.toHaveBeenCalled();
});

it("reports monotonic local-read progress with the actual Blob size", async () => {
  const progress = vi.fn<(loaded: number, total: number) => void>();
  const pending = readFileDataUrl(new Blob(["abcd"]), {
    onLocalReadProgress: progress,
  });
  const reader = readerAt(0);
  reader.dispatchEvent(localProgress(2));
  reader.dispatchEvent(localProgress(1));
  reader.dispatchEvent(localProgress(Number.NaN));
  reader.dispatchEvent(localProgress(-1));
  reader.readyState = MockFileReader.DONE;
  reader.result = "data:application/octet-stream;base64,YWJjZA==";
  reader.dispatchEvent(new Event("load"));
  await expect(pending).resolves.toBe(reader.result);
  expect(progress.mock.calls).toEqual([
    [2, 4],
    [2, 4],
    [4, 4],
  ]);
  reader.dispatchEvent(localProgress(4));
  expect(progress).toHaveBeenCalledTimes(3);
});

it("cleans listeners on success and leaves later cancellation harmless", async () => {
  const controller = new AbortController();
  const pending = readFileDataUrl(new Blob(["a"]), {
    signal: controller.signal,
  });
  const reader = readerAt(0);
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  reader.readyState = MockFileReader.DONE;
  reader.result = "data:text/plain;base64,YQ==";
  reader.dispatchEvent(new Event("load"));
  await expect(pending).resolves.toBe(reader.result);
  expect(remove.mock.calls.map(([event]) => event)).toContain("abort");
  controller.abort();
  expect(reader.abort).not.toHaveBeenCalled();
});

it("cleans up when the native read throws synchronously", async () => {
  const controller = new AbortController();
  const reason = new Error("Synthetic read failure");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  read.mockImplementationOnce(() => {
    throw reason;
  });
  await expect(
    readFileDataUrl(new Blob(["a"]), { signal: controller.signal })
  ).rejects.toBe(reason);
  expect(readerAt(0).abort).toHaveBeenCalledTimes(1);
  expect(remove.mock.calls.map(([event]) => event)).toContain("abort");
});

it("rejects an already cancelled picker before opening the chooser", async () => {
  const controller = new AbortController();
  const reason = new Error("Synthetic cancellation");
  controller.abort(reason);
  await expect(
    pickBrowserAttachments({ signal: controller.signal })
  ).rejects.toBe(reason);
  expect(input.click).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it("cancels an open chooser and ignores a later selection", async () => {
  const controller = new AbortController();
  const reason = new Error("Synthetic cancellation");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const pending = pickBrowserAttachments({ signal: controller.signal });
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(input.remove).toHaveBeenCalledTimes(1);
  expect(remove.mock.calls.map(([event]) => event)).toContain("abort");
  input.files = [new File(["a"], "late.txt")];
  input.dispatchEvent(new Event("change"));
  expect(read).not.toHaveBeenCalled();
});

it("cancels every active reader without presenting a partial selection", async () => {
  const controller = new AbortController();
  const reason = new Error("Synthetic cancellation");
  const progress = vi.fn<(loaded: number, total: number) => void>();
  const pending = pickBrowserAttachments({
    signal: controller.signal,
    onLocalReadProgress: progress,
  });
  input.files = [new File(["a"], "one.txt"), new File(["b"], "two.txt")];
  input.dispatchEvent(new Event("change"));
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(readers.map((reader) => reader.abort.mock.calls.length)).toEqual([
    1, 1,
  ]);
  for (const reader of readers) reader.dispatchEvent(localProgress(1));
  expect(progress).not.toHaveBeenCalled();
});

it("aggregates local file bytes while preserving selection order", async () => {
  const progress = vi.fn<(loaded: number, total: number) => void>();
  const pending = pickBrowserAttachments({ onLocalReadProgress: progress });
  input.files = [
    new File(["abc"], "one.txt", { type: "text/plain" }),
    new File(["de"], "two.txt", { type: "text/plain" }),
  ];
  input.dispatchEvent(new Event("change"));
  readerAt(0).dispatchEvent(localProgress(1));
  readerAt(1).readyState = MockFileReader.DONE;
  readerAt(1).result = "data:text/plain;base64,ZGU=";
  readerAt(1).dispatchEvent(new Event("load"));
  readerAt(0).readyState = MockFileReader.DONE;
  readerAt(0).result = "data:text/plain;base64,YWJj";
  readerAt(0).dispatchEvent(new Event("load"));
  expect((await pending).map((attachment) => attachment.filename)).toEqual([
    "one.txt",
    "two.txt",
  ]);
  expect(progress.mock.calls).toEqual([
    [1, 5],
    [3, 5],
    [5, 5],
  ]);
});

it("fails and cancels siblings when a local-progress callback throws", async () => {
  const reason = new Error("Synthetic progress handler failure");
  const pending = pickBrowserAttachments({
    onLocalReadProgress() {
      throw reason;
    },
  });
  input.files = [new File(["a"], "one.txt"), new File(["b"], "two.txt")];
  input.dispatchEvent(new Event("change"));
  readerAt(0).dispatchEvent(localProgress(1));
  await expect(pending).rejects.toBe(reason);
  expect(readers.map((reader) => reader.abort.mock.calls.length)).toEqual([
    1, 1,
  ]);
});

it("removes the chooser and signal listener if opening it fails", async () => {
  const controller = new AbortController();
  const reason = new Error("Synthetic chooser failure");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  input.click.mockImplementationOnce(() => {
    throw reason;
  });
  await expect(
    pickBrowserAttachments({ signal: controller.signal })
  ).rejects.toBe(reason);
  expect(input.remove).toHaveBeenCalledTimes(1);
  expect(remove.mock.calls.map(([event]) => event)).toContain("abort");
});

function localProgress(loaded: number) {
  return Object.assign(new Event("progress"), {
    loaded,
    total: 1_000_000,
    lengthComputable: true,
  });
}

it("normalizes a non-Error abort reason before allocating a local reader", async () => {
  const controller = new AbortController();
  controller.abort("Synthetic cancellation");
  await expect(
    readFileDataUrl(new Blob(["a"]), { signal: controller.signal })
  ).rejects.toMatchObject({
    name: "Error",
    message: "Reading the file was cancelled.",
    cause: "Synthetic cancellation",
  });
  expect(readers).toEqual([]);
});

it("normalizes a non-Error cancellation and still aborts every sibling", async () => {
  const controller = new AbortController();
  const pending = pickBrowserAttachments({ signal: controller.signal });
  input.files = [new File(["a"], "one.txt"), new File(["b"], "two.txt")];
  input.dispatchEvent(new Event("change"));
  controller.abort("Synthetic cancellation");
  await expect(pending).rejects.toMatchObject({
    name: "Error",
    message: "The files could not be opened.",
    cause: "Synthetic cancellation",
  });
  expect(readers.map((reader) => reader.abort.mock.calls.length)).toEqual([
    1, 1,
  ]);
});
