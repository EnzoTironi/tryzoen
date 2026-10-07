import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform, useColorScheme } from "react-native";

// Zoen palette. Neutrals carry a faint night-sky blue so the product reads as
// one family with the landing and sign-in. Text pairings clear WCAG AA.
const lightColors = {
  canvas: "#ffffff",
  surface: "#ffffff",
  ink: "#16181d",
  muted: "#5f6470",
  line: "#dfe1e6",
  wash: "#f2f3f6",
  accent: "#0a66e0",
  accentSoft: "#eaf1fe",
  success: "#1f7a46",
  successSoft: "#e8f4ec",
  danger: "#c9342b",
  sidebar: "#f6f7f9",
  selection: "#0a63d8",
  selectedInk: "#ffffff",
  outgoing: "#0a6cf0",
  incoming: "#eceef2",
};

const darkColors: typeof lightColors = {
  canvas: "#0c0d10",
  surface: "#17191e",
  ink: "#f3f4f6",
  muted: "#a2a7b2",
  line: "#2c2f36",
  wash: "#22252b",
  accent: "#4d94ff",
  accentSoft: "#16233a",
  success: "#5cc489",
  successSoft: "#15281d",
  danger: "#ff6f66",
  sidebar: "#111216",
  selection: "#0a63d8",
  selectedInk: "#ffffff",
  outgoing: "#0a6cf0",
  incoming: "#24272d",
};

/** 4-point spacing scale shared by every companion surface. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Corner radii: controls, cards, sheets, and fully rounded pills. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/**
 * Type scale. Sizes follow the Apple text styles the product already echoes;
 * tracking tightens as size grows so large titles stay compact.
 */
export const typeScale = {
  largeTitle: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "600",
    letterSpacing: -0.9,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  headline: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400",
    letterSpacing: -0.1,
  },
  callout: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    letterSpacing: 0,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
    letterSpacing: 0,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    letterSpacing: 0,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
} as const;

/** Elevation as web box shadows; native renders the same flat surface. */
export const elevation = {
  card: "0 1px 2px rgba(16,24,40,0.05), 0 0 0 1px rgba(16,24,40,0.05)",
  raised:
    "0 1px 2px rgba(16,24,40,0.04), 0 6px 20px -4px rgba(16,24,40,0.10), 0 0 0 1px rgba(16,24,40,0.05)",
  floating:
    "0 2px 6px rgba(16,24,40,0.05), 0 18px 48px -12px rgba(16,24,40,0.22), 0 0 0 1px rgba(16,24,40,0.06)",
} as const;

export function useDarkAppearance() {
  return useColorScheme() === "dark";
}

export function useColors() {
  return useDarkAppearance() ? darkColors : lightColors;
}

// Until a platform preference can be read, keep controls opaque and stationary.
const initialPreferences = {
  reduceMotion: true,
  reduceTransparency: true,
  increasedContrast: false,
  forcedColors: false,
};
let preferences = initialPreferences;
const preferenceListeners = new Set<() => void>();
let stopPreferences: (() => void) | undefined;

function updatePreference(name: keyof typeof preferences, value: boolean) {
  if (preferences[name] === value) return;
  preferences = { ...preferences, [name]: value };
  for (const notify of preferenceListeners) notify();
}

function listenToPreferences() {
  const cleanups: (() => void)[] = [];
  if (Platform.OS === "web") {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return () => undefined;
    const watch = (
      name: keyof typeof preferences,
      queries: readonly string[],
      read: (matches: readonly boolean[]) => boolean
    ) => {
      const media = queries.map((query) => window.matchMedia(query));
      // An unsupported preference must not masquerade as no preference.
      if (media.some((query) => typeof query.addEventListener !== "function"))
        return;
      const change = () => {
        updatePreference(name, read(media.map((query) => query.matches)));
      };
      for (const query of media) {
        query.addEventListener("change", change);
        cleanups.push(() => {
          query.removeEventListener("change", change);
        });
      }
      change();
    };
    watch(
      "reduceMotion",
      [
        "(prefers-reduced-motion: reduce)",
        "(prefers-reduced-motion: no-preference)",
      ],
      ([reduced, normal]) => reduced === true || normal !== true
    );
    watch(
      "reduceTransparency",
      [
        "(prefers-reduced-transparency: reduce)",
        "(prefers-reduced-transparency: no-preference)",
      ],
      ([reduced, normal]) => reduced === true || normal !== true
    );
    watch(
      "increasedContrast",
      ["(prefers-contrast: more)"],
      ([value]) => value === true
    );
    watch(
      "forcedColors",
      ["(forced-colors: active)"],
      ([value]) => value === true
    );
  } else if (Platform.OS === "ios" || Platform.OS === "android") {
    let active = true;
    const watches = [
      [
        "reduceMotion",
        "reduceMotionChanged",
        () => AccessibilityInfo.isReduceMotionEnabled(),
      ],
      ...(Platform.OS === "ios"
        ? ([
            [
              "reduceTransparency",
              "reduceTransparencyChanged",
              () => AccessibilityInfo.isReduceTransparencyEnabled(),
            ],
            [
              "increasedContrast",
              "darkerSystemColorsChanged",
              () => AccessibilityInfo.isDarkerSystemColorsEnabled(),
            ],
          ] as const)
        : ([
            [
              "increasedContrast",
              "highTextContrastChanged",
              () => AccessibilityInfo.isHighTextContrastEnabled(),
            ],
          ] as const)),
    ] as const;
    for (const [name, event, read] of watches) {
      let revision = 0;
      try {
        const subscription = AccessibilityInfo.addEventListener(
          event,
          (value) => {
            revision++;
            if (active) updatePreference(name, value);
          }
        );
        cleanups.push(() => {
          subscription.remove();
        });
        void Promise.resolve()
          .then(read)
          .then((value) => {
            // A newer system event wins over an older asynchronous initial query.
            if (active && revision === 0) updatePreference(name, value);
          })
          .catch(() => undefined);
      } catch {
        // A missing native capability retains its conservative fallback.
      }
    }
    cleanups.push(() => {
      active = false;
    });
  }
  return () => {
    // Mark initial native queries inactive before removing their listeners.
    for (let index = cleanups.length - 1; index >= 0; index--)
      cleanups[index]?.();
  };
}

function subscribePreferences(notify: () => void) {
  preferenceListeners.add(notify);
  if (preferenceListeners.size === 1) stopPreferences = listenToPreferences();
  return () => {
    preferenceListeners.delete(notify);
    if (preferenceListeners.size === 0) {
      stopPreferences?.();
      stopPreferences = undefined;
      preferences = initialPreferences;
    }
  };
}

/** One system preference source, independent from the platform appearance hook. */
export function useAccessibilityPreferences() {
  return useSyncExternalStore(
    subscribePreferences,
    () => preferences,
    () => initialPreferences
  );
}

// Native text already uses the platform font; web must not inherit a brand font.
export const systemFont =
  Platform.OS === "web"
    ? '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "Helvetica Neue", sans-serif'
    : undefined;
