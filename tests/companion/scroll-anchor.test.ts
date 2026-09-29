import { afterEach, expect, it, vi } from "vitest";
import { captureMessageAnchor } from "../../packages/companion-ui/src/conversation/scroll-anchor";
class Viewport {
  constructor(readonly inverted = false) {}
  scrollTop = 100;
  position = 120;
  row = {
    isConnected: true,
    getBoundingClientRect: () => ({
      top: this.position + (this.inverted ? this.scrollTop : -this.scrollTop),
      bottom:
        this.position + (this.inverted ? this.scrollTop : -this.scrollTop) + 80,
    }),
  };
  getBoundingClientRect() {
    return { top: 0, bottom: 400 };
  }
  querySelectorAll() {
    return [this.row];
  }
}
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "preserves the visible row across prepending and media resize (inverted=%s)",
  (inverted) => {
    vi.stubGlobal("HTMLElement", Viewport);
    const node = new Viewport(inverted);
    const restore = captureMessageAnchor(
      node,
      inverted ? "room-message" : "agent-message",
      inverted
    );
    node.position += 50;
    restore?.();
    expect(node.scrollTop).toBe(inverted ? 50 : 150);
    restore?.();
    expect(node.scrollTop).toBe(inverted ? 50 : 150);
  }
);
it("does not move when the captured row was removed or no web DOM exists", () => {
  vi.stubGlobal("HTMLElement", Viewport);
  const node = new Viewport();
  const restore = captureMessageAnchor(node, "agent-message");
  node.row.isConnected = false;
  node.position += 200;
  restore?.();
  expect(node.scrollTop).toBe(100);
  expect(captureMessageAnchor(null, "agent-message")).toBeUndefined();
  vi.stubGlobal("HTMLElement", undefined);
  expect(captureMessageAnchor(node, "agent-message")).toBeUndefined();
});
