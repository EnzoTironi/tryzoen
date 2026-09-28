import { createContext, useContext, type ReactNode } from "react";
import { Modal, useWindowDimensions } from "react-native";

export interface CompanionOverlayProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly focusOnOpen?: () => void;
}
function NativeOverlay({
  children,
  onClose,
  focusOnOpen,
}: CompanionOverlayProps) {
  const compact = useWindowDimensions().width < 720;
  return (
    <Modal
      transparent
      animationType={compact ? "slide" : "fade"}
      onRequestClose={onClose}
      onShow={focusOnOpen}
    >
      {children}
    </Modal>
  );
}
const OverlayContext = createContext<
  (props: CompanionOverlayProps) => ReactNode
>((props) => <NativeOverlay {...props} />);
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
