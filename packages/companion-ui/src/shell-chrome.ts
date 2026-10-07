import { createContext, useContext } from "react";

/**
 * What the shell's floating chrome needs from scrolling content: how much
 * room the glass tab bar takes at the bottom, and a scroll report so the bar
 * can minimise while people read.
 */
export const ShellChrome = createContext<{
  readonly bottomInset: number;
  readonly onScroll?: (offset: number) => void;
}>({ bottomInset: 0 });

export function useShellChrome() {
  return useContext(ShellChrome);
}
