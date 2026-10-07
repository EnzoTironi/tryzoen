import { useI18n } from "./i18n";
import { useMemo, useState } from "react";
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
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SheetSurface } from "./sheet";
import { IconButton } from "./icon-button";
import {
  radius,
  space,
  systemFont,
  useTypeScale,
  useColors,
  type TypeScale,
} from "./theme";

const pages = [
  { id: "general", label: "General", icon: Cog, group: 0 },
  { id: "connectors", label: "Connectors", icon: Grid2X2, group: 0 },
  {
    id: "channels",
    label: "Messaging channels",
    icon: MessageCircle,
    group: 0,
  },
  { id: "devices", label: "Devices", icon: MonitorSmartphone, group: 0 },
  { id: "wallet", label: "Wallet", icon: Wallet, group: 1 },
  { id: "vault", label: "Credential vault", icon: Shield, group: 1 },
  { id: "permissions", label: "Permissions", icon: Hand, group: 1 },
  { id: "data", label: "Data controls", icon: LockKeyhole, group: 1 },
  { id: "help", label: "Help and support", icon: CircleHelp, group: 2 },
  { id: "legal", label: "Legal information", icon: ShieldCheck, group: 2 },
] as const;
const groups = [0, 1, 2] as const;

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

export function SettingsPanel({
  page,
  onSelect,
  onBack,
  onClose,
  onSignOut,
  signingOut,
  error,
  children,
}: {
  readonly page?: SettingsPage;
  readonly onSelect: (page: SettingsPage) => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onSignOut: () => void;
  readonly signingOut: boolean;
  readonly error?: string;
  readonly children?: ReactNode;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const type = useTypeScale();
  const styles = useMemo(() => createStyles(colors, type), [colors, type]);
  const [hovered, setHovered] = useState<string>();
  const title = t(pages.find((item) => item.id === page)?.label ?? "Settings");
  return (
    <SheetSurface
      title={title}
      onClose={onClose}
      maxWidth={560}
      panelStyle={styles.panel}
    >
      <View style={styles.header}>
        {page && (
          <IconButton
            label={t("Back to settings")}
            icon={ArrowLeft}
            onPress={onBack}
          />
        )}
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <IconButton label={t("Close settings")} icon={X} onPress={onClose} />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {page ? (
          children
        ) : (
          <>
            {groups.map((group) => (
              <View key={group} style={styles.group}>
                {pages
                  .filter((item) => item.group === group)
                  .map(({ id, label, icon: Icon }, index) => (
                    <Pressable
                      key={id}
                      accessibilityRole="button"
                      onPress={() => {
                        onSelect(id);
                      }}
                      onHoverIn={() => {
                        setHovered(id);
                      }}
                      onHoverOut={() => {
                        setHovered(undefined);
                      }}
                      style={({ pressed }) => [
                        styles.row,
                        hovered === id && styles.hovered,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.icon}>
                        <Icon size={17} strokeWidth={1.8} color={colors.ink} />
                        {id === "vault" && (
                          <LockKeyhole
                            size={7}
                            strokeWidth={2.4}
                            color={colors.ink}
                            style={styles.vaultLock}
                          />
                        )}
                      </View>
                      <View style={[styles.rowBody, index > 0 && styles.rule]}>
                        <Text style={styles.label}>{t(label)}</Text>
                        <ChevronRight
                          size={17}
                          strokeWidth={1.6}
                          color={colors.muted}
                        />
                      </View>
                    </Pressable>
                  ))}
              </View>
            ))}
            <View style={styles.group}>
              <Pressable
                accessibilityRole="button"
                aria-disabled={signingOut}
                disabled={signingOut}
                onPress={onSignOut}
                onHoverIn={() => {
                  setHovered("sign-out");
                }}
                onHoverOut={() => {
                  setHovered(undefined);
                }}
                style={({ pressed }) => [
                  styles.row,
                  hovered === "sign-out" && styles.hovered,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.icon, styles.dangerIcon]}>
                  <LogOut size={17} strokeWidth={1.8} color={colors.danger} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.label, styles.danger]}>
                    {t(signingOut ? "Signing out…" : "Sign out")}
                  </Text>
                </View>
              </Pressable>
            </View>
          </>
        )}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </ScrollView>
    </SheetSurface>
  );
}

function createStyles(colors: ReturnType<typeof useColors>, type: TypeScale) {
  return StyleSheet.create({
    panel: { height: "85%", maxHeight: 780 },
    header: {
      minHeight: 44,
      paddingHorizontal: space.xl,
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      marginBottom: space.md,
    },
    title: {
      fontFamily: systemFont,
      flex: 1,
      ...type.title,
      color: colors.ink,
    },
    content: {
      paddingHorizontal: space.xl,
      paddingBottom: space.xxl,
      gap: space.lg,
    },
    group: {
      backgroundColor: colors.wash,
      borderRadius: radius.lg,
      paddingHorizontal: space.xs,
      paddingVertical: space.xs,
    },
    icon: {
      width: 30,
      height: 30,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      boxShadow: "0 1px 2px rgba(16,24,40,0.08)",
    },
    dangerIcon: { backgroundColor: colors.surface },
    vaultLock: { position: "absolute", top: 10 },
    row: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      paddingLeft: space.sm + 2,
      borderRadius: radius.md,
      outlineOffset: -2,
    },
    rowBody: {
      flex: 1,
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      paddingRight: space.md,
    },
    rule: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    hovered: { backgroundColor: `${colors.line}80` },
    label: {
      fontFamily: systemFont,
      flex: 1,
      ...type.body,
      fontSize: 16,
      color: colors.ink,
    },
    danger: { color: colors.danger, fontWeight: "500" },
    pressed: { opacity: 0.6 },
    error: {
      fontFamily: systemFont,
      ...type.footnote,
      fontSize: 14,
      color: colors.danger,
      marginTop: space.md,
    },
  });
}
