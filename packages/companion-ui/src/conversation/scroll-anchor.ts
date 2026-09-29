/** Preserve a visible web row when pagination or media changes list geometry. */
export function captureMessageAnchor(
  node: unknown,
  rowId: "agent-message" | "room-message",
  inverted = false
) {
  if (typeof HTMLElement === "undefined" || !(node instanceof HTMLElement))
    return undefined;
  const viewport = node.getBoundingClientRect();
  const row = Array.from(
    node.querySelectorAll(`[data-testid="${rowId}"]`)
  ).find((item) => {
    const bounds = item.getBoundingClientRect();
    return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
  });
  if (!row) return undefined;
  const offset = row.getBoundingClientRect().top - viewport.top;
  return () => {
    if (!row.isConnected) return;
    const current =
      row.getBoundingClientRect().top - node.getBoundingClientRect().top;
    node.scrollTop += inverted ? offset - current : current - offset;
  };
}
