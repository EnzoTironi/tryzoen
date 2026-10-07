import { useMemo } from "react";
import { Platform, StyleSheet } from "react-native";
import {
  useAccessibilityPreferences,
  useColors,
  useDarkAppearance,
} from "./theme";

/**
 * Liquid Glass for the functional layer (tab bar, toolbars, sidebar, sheets,
 * the composer). Apple keeps the material off content, so only floating
 * controls and navigation should use these styles. The web mirror of these
 * tokens lives in app/styles/brand/glass.css.
 *
 * Fills stay dense enough that ink, muted labels and the accent remain
 * readable over both white and black content beneath the glass.
 */
const glassTokens = {
  /** Backdrop blur with a saturation lift so colour beneath stays lively. */
  blur: "blur(20px) saturate(180%)",
  /** Regular glass: icon controls and the composer (72%). */
  regular: "b8",
  /** Thick glass: surfaces with small or long text, tab bar, sheets (88%). */
  thick: "e0",
  /** Hairline edge at rest; increased contrast swaps it for ink. */
  edge: "70",
} as const;

/** Elevation for glass. Shadows never change with accessibility settings. */
const glassShadow = {
  light: {
    floating:
      "inset 0 1px 0 rgba(255,255,255,0.75), inset 0 0 0 0.5px rgba(255,255,255,0.4), 0 10px 30px -8px rgba(16,24,40,0.22), 0 2px 6px rgba(16,24,40,0.06)",
    control:
      "inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 12px rgba(16,24,40,0.08)",
    panel:
      "inset 0 1px 0 rgba(255,255,255,0.75), 0 1px 2px rgba(16,24,40,0.04), 0 8px 28px -10px rgba(16,24,40,0.14)",
  },
  dark: {
    floating:
      "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 0.5px rgba(255,255,255,0.06), 0 12px 32px -8px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.3)",
    control: "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 12px rgba(0,0,0,0.35)",
    panel:
      "inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.3), 0 8px 28px -10px rgba(0,0,0,0.5)",
  },
} as const;

export type GlassElevation = keyof (typeof glassShadow)["light"] | "none";

/**
 * The selected-tab lens: an opaque tint so the accent label keeps 4.6:1
 * (light) and 4.8:1 (dark) contrast whatever scrolls beneath the bar.
 */
const glassLens = { light: "#edf0f5", dark: "#262a31" } as const;

function blurAvailable() {
  return (
    Platform.OS === "web" &&
    typeof CSS !== "undefined" &&
    CSS.supports("backdrop-filter", "blur(1px)")
  );
}

export interface GlassMode {
  /** Solid surface: Reduce Transparency, more contrast, or no blur support. */
  readonly opaque: boolean;
  readonly increasedContrast: boolean;
  readonly dark: boolean;
}

/** Reads the system preferences that decide whether glass can be shown. */
export function useGlassMode(): GlassMode {
  const preferences = useAccessibilityPreferences();
  const dark = useDarkAppearance();
  const increasedContrast =
    preferences.increasedContrast || preferences.forcedColors;
  const opaque =
    preferences.reduceTransparency || increasedContrast || !blurAvailable();
  return useMemo(
    () => ({ opaque, increasedContrast, dark }),
    [opaque, increasedContrast, dark]
  );
}

/**
 * One glass surface. Geometry and shadow never depend on the accessibility
 * state, so a preference change only swaps fill, edge and blur.
 */
export function glassSurface(
  colors: ReturnType<typeof useColors>,
  mode: Pick<GlassMode, "opaque" | "increasedContrast"> & {
    readonly dark?: boolean;
  },
  {
    thickness = "regular",
    elevation = "control",
    fill = colors.surface,
  }: {
    readonly thickness?: "regular" | "thick";
    readonly elevation?: GlassElevation;
    readonly fill?: string;
  } = {}
) {
  return {
    backgroundColor: mode.opaque ? fill : `${fill}${glassTokens[thickness]}`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mode.increasedContrast
      ? colors.ink
      : mode.opaque
        ? colors.line
        : `${colors.line}${glassTokens.edge}`,
    ...(Platform.OS === "web"
      ? { backdropFilter: mode.opaque ? "none" : glassTokens.blur }
      : {}),
    ...(elevation === "none"
      ? {}
      : { boxShadow: glassShadow[mode.dark ? "dark" : "light"][elevation] }),
  } as const;
}

/** Convenience hook: the mode plus a bound surface factory. */
export function useGlass() {
  const colors = useColors();
  const mode = useGlassMode();
  return useMemo(
    () => ({
      ...mode,
      lens: mode.dark ? glassLens.dark : glassLens.light,
      surface: (options?: Parameters<typeof glassSurface>[2]) =>
        glassSurface(colors, mode, options),
    }),
    [colors, mode]
  );
}
