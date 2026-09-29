import { afterEach, expect, test, vi } from "vitest";
import { listenHistoryIntent } from "../../packages/companion-ui/src/session/scroll-intent";

class Viewport extends EventTarget {
  editable = false;
  closest() {
    return this.editable ? this : null;
  }
}
afterEach(() => vi.unstubAllGlobals());
test("short history accepts upward wheel, touch and keyboard intent, excludes editing and removes listeners", () => {
  vi.stubGlobal("HTMLElement", Viewport);
  const node = new Viewport();
  const load = vi.fn<() => void>();
  const stop = listenHistoryIntent(node, load);
  const send = (name: string, properties: Record<string, unknown>) =>
    node.dispatchEvent(Object.assign(new Event(name), properties));
  expect(load).not.toHaveBeenCalled();
  send("wheel", { deltaY: 20 });
  expect(load).not.toHaveBeenCalled();
  send("wheel", { deltaY: -20 });
  send("touchstart", { touches: [{ clientY: 30 }] });
  send("touchmove", { touches: [{ clientY: 45 }] });
  send("keydown", { key: "PageUp" });
  expect(load).toHaveBeenCalledTimes(3);
  node.editable = true;
  send("keydown", { key: "ArrowUp" });
  expect(load).toHaveBeenCalledTimes(3);
  stop?.();
  send("wheel", { deltaY: -20 });
  expect(load).toHaveBeenCalledTimes(3);
  expect(listenHistoryIntent(null, load)).toBeUndefined();
});
