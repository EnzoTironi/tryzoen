import { Platform, useColorScheme } from "react-native";

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

// Native text already uses the platform font; web must not inherit a brand font.
export const systemFont =
  Platform.OS === "web"
    ? '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
    : undefined;
