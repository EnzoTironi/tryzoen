import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform, useColorScheme } from "react-native";

const lightColors = {
  canvas: "#ffffff",
  surface: "#ffffff",
  ink: "#1c1c1e",
  muted: "#6c6c70",
  line: "#d1d1d6",
  wash: "#f2f2f7",
  accent: "#0071eb",
  danger: "#c9342b",
  sidebar: "#f7f7f9",
  selection: "#0069df",
  selectedInk: "#ffffff",
  outgoing: "#0071eb",
  incoming: "#e9e9eb",
};

const darkColors: typeof lightColors = {
  canvas: "#000000",
  surface: "#1c1c1e",
  ink: "#f5f5f7",
  muted: "#a1a1a6",
  line: "#38383a",
  wash: "#2c2c2e",
  accent: "#0a84ff",
  danger: "#ff6961",
  sidebar: "#161618",
  selection: "#0071eb",
  selectedInk: "#ffffff",
  outgoing: "#0071eb",
  incoming: "#262628",
};

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
    ? '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
    : undefined;
