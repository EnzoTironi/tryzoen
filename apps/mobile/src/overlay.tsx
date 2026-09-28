import type { ReactNode } from "react";

/** iOS and Android retain the shared React Native Modal adapter. */
export function MobileOverlayProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return children;
}
