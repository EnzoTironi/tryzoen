/** Wheel/touch/keyboard intent still exists when a short list cannot scroll. */
export function listenHistoryIntent(node: unknown, onUp: () => void) {
  if (typeof HTMLElement === "undefined" || !(node instanceof HTMLElement))
    return undefined;
  let touchY: number | undefined;
  const wheel = (event: WheelEvent) => {
    if (event.deltaY < 0) onUp();
  };
  const start = (event: TouchEvent) => {
    touchY = event.touches[0]?.clientY;
  };
  const move = (event: TouchEvent) => {
    const next = event.touches[0]?.clientY;
    if (next !== undefined && touchY !== undefined && next > touchY) onUp();
    touchY = next;
  };
  const key = (event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, [contenteditable="true"]')
    )
      return;
    if (["ArrowUp", "PageUp", "Home"].includes(event.key)) onUp();
  };
  node.addEventListener("wheel", wheel, { passive: true });
  node.addEventListener("touchstart", start, { passive: true });
  node.addEventListener("touchmove", move, { passive: true });
  node.addEventListener("keydown", key);
  return () => {
    node.removeEventListener("wheel", wheel);
    node.removeEventListener("touchstart", start);
    node.removeEventListener("touchmove", move);
    node.removeEventListener("keydown", key);
  };
}
