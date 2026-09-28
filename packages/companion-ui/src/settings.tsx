import type { ReactNode } from "react";
import {
  ArrowLeft,
  ChevronRight,
  CircleHelp,
  Cog,
  Grid2X2,
  Hand,
  MonitorSmartphone,
  LockKeyhole,
  LogOut,
  MessageCircle,
  ShieldCheck,
  Shield,
  Wallet,
  X,
} from "lucide-react-native";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { CompanionOverlay } from "./overlay";
import { IconButton } from "./icon-button";
import { colors } from "./theme";

const pages = [
  { id: "general", label: "General", icon: Cog },
  { id: "connectors", label: "Connectors", icon: Grid2X2 },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "vault", label: "Credential vault", icon: Shield },
  { id: "permissions", label: "Permissions", icon: Hand },
  { id: "channels", label: "Messaging channels", icon: MessageCircle },
  { id: "devices", label: "Devices", icon: MonitorSmartphone },
  { id: "data", label: "Data controls", icon: LockKeyhole },
  { id: "help", label: "Help and support", icon: CircleHelp },
  { id: "legal", label: "Legal information", icon: ShieldCheck },
] as const;

// Keep this public route contract independent of native icon/rendering types.
export type SettingsPage =
  | "general"
  | "connectors"
  | "wallet"
  | "vault"
  | "permissions"
  | "channels"
  | "devices"
  | "data"
  | "help"
  | "legal";

const untranslated = (text: string) => text;

export function SettingsPanel({
  page,
  onSelect,
  onBack,
  onClose,
  onSignOut,
  signingOut,
  error,
  children,
  translate = untranslated,
}: {
  readonly page?: SettingsPage;
  readonly onSelect: (page: SettingsPage) => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onSignOut: () => void;
  readonly signingOut: boolean;
  readonly error?: string;
  readonly children?: ReactNode;
  readonly translate?: (text: string) => string;
}) {
  const compact = useWindowDimensions().width < 720;
  const title = translate(
    pages.find((item) => item.id === page)?.label ?? "Settings"
  );
  return (
    <CompanionOverlay title={title} onClose={onClose}>
      <View style={[styles.backdrop, !compact && styles.desktopBackdrop]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate("Close settings")}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.panel, !compact && styles.desktopPanel]}>
          {compact && <View style={styles.handle} />}
          <View style={styles.header}>
            {page && (
              <IconButton
                label={translate("Back to settings")}
                icon={ArrowLeft}
                onPress={onBack}
              />
            )}
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {(!compact || page) && (
              <IconButton
                label={translate("Close settings")}
                icon={X}
                onPress={onClose}
              />
            )}
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {page ? (
              children
            ) : (
              <>
                {pages.map(({ id, label, icon: Icon }) => (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    onPress={() => {
                      onSelect(id);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.icon}>
                      <Icon size={20} strokeWidth={1.7} color={colors.ink} />
                      {id === "vault" && (
                        <LockKeyhole
                          size={8}
                          strokeWidth={2.2}
                          color={colors.ink}
                          style={styles.vaultLock}
                        />
                      )}
                    </View>
                    <Text style={styles.label}>{translate(label)}</Text>
                    <ChevronRight
                      size={17}
                      strokeWidth={1.5}
                      color={colors.muted}
                    />
                  </Pressable>
                ))}
                <View style={styles.divider} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: signingOut }}
                  disabled={signingOut}
                  onPress={onSignOut}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  <LogOut size={20} strokeWidth={1.7} color={colors.ink} />
                  <Text style={styles.label}>
                    {translate(signingOut ? "Signing out…" : "Sign out")}
                  </Text>
                </Pressable>
              </>
            )}
            {error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </CompanionOverlay>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: "rgba(252,252,252,0.6)",
  },
  desktopBackdrop: { justifyContent: "center", padding: 32 },
  panel: {
    width: "100%",
    height: "85%",
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 12,
    boxShadow: "0 -8px 32px rgba(0,0,0,0.045)",
  },
  desktopPanel: {
    width: 560,
    maxWidth: "100%",
    height: "90%",
    maxHeight: 780,
    borderRadius: 26,
    paddingTop: 20,
  },
  handle: {
    width: 48,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#f1f1f2",
    alignSelf: "center",
    marginBottom: 12,
  },
  header: {
    minHeight: 40,
    paddingHorizontal: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    color: colors.ink,
  },
  content: { paddingHorizontal: 28, paddingBottom: 28 },
  icon: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  vaultLock: { position: "absolute", top: 5 },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  label: { flex: 1, fontSize: 16, lineHeight: 22, color: colors.ink },
  pressed: { opacity: 0.55 },
  divider: { height: 1, backgroundColor: "#eeeeef", marginVertical: 6 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: 12 },
});
