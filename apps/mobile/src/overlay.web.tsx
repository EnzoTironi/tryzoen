import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  CompanionOverlayProvider,
  type CompanionOverlayProps,
} from "@zoen/companion-ui";

export function MobileOverlayProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <CompanionOverlayProvider renderOverlay={renderOverlay}>
      {children}
    </CompanionOverlayProvider>
  );
}

function renderOverlay({
  title,
  children,
  onClose,
  focusOnOpen,
}: CompanionOverlayProps) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          style={{ position: "fixed", inset: 0, zIndex: 9999 }}
        />
        <Dialog.Popup
          aria-label={title}
          aria-describedby={undefined}
          initialFocus={
            focusOnOpen
              ? () => {
                  focusOnOpen();
                  return false;
                }
              : undefined
          }
          style={{
            position: "fixed",
            inset: 0,
            width: "100%",
            height: "100dvh",
            zIndex: 10000,
            display: "flex",
            flexDirection: "column",
            outline: "none",
          }}
        >
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
