"use client";
import type { CompanionOverlayProps } from "@zoen/companion-ui";
import { Dialog, DialogContent, DialogTitle } from "@web/components/ui/dialog";

export function renderWebCompanionOverlay({
  children,
  title,
  onClose,
  focusOnOpen,
}: CompanionOverlayProps) {
  return (
    <Dialog
      open
      modal={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        animated={false}
        backdropClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
        initialFocus={
          focusOnOpen
            ? () => {
                focusOnOpen();
                return false;
              }
            : undefined
        }
        className="fixed inset-0 flex h-dvh w-full max-w-none! translate-0 rounded-none bg-transparent p-0 ring-0"
        aria-describedby={undefined}
        aria-modal={true}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
