"use client";
import { useState, useSyncExternalStore } from "react";

const eventName = "zoen-conversation-panel-preference";
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(eventName, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(eventName, onChange);
  };
}
const serverPreference = () => false;

export function useConversationPanelPreference(scope: string) {
  const key = `zoen:conversation-panel:${scope}`;
  const [unsaved, setUnsaved] = useState<boolean>();
  const [error, setError] = useState<string>();
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) === "true";
      } catch {
        return false;
      }
    },
    serverPreference
  );
  return {
    keepVisible: unsaved ?? stored,
    error,
    setKeepVisible: (value: boolean) => {
      try {
        localStorage.setItem(key, String(value));
        setUnsaved(undefined);
        setError(undefined);
        window.dispatchEvent(new Event(eventName));
      } catch {
        setUnsaved(value);
        setError(
          "The panel preference applies for now, but couldn’t be saved on this device."
        );
      }
    },
  };
}
