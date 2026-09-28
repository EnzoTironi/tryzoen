import { createContext, useContext, type ReactNode } from "react";
import { Modal } from "react-native";

export interface CompanionOverlayProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly focusOnOpen?: () => void;
}
function renderNativeOverlay({
  children,
  onClose,
  focusOnOpen,
}: CompanionOverlayProps) {
  return (
    <Modal
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={focusOnOpen}
    >
      {children}
    </Modal>
  );
}
const OverlayContext =
  createContext<(props: CompanionOverlayProps) => ReactNode>(
    renderNativeOverlay
  );
export function CompanionOverlayProvider({
  renderOverlay,
  children,
}: {
  readonly renderOverlay: (props: CompanionOverlayProps) => ReactNode;
  readonly children: ReactNode;
}) {
  return <OverlayContext value={renderOverlay}>{children}</OverlayContext>;
}
export function CompanionOverlay(props: CompanionOverlayProps) {
  const renderOverlay = useContext(OverlayContext);
  return renderOverlay(props);
}
